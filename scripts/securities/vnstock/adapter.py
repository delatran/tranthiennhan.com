"""One bounded, public vnstock Unified API request per process.

The launcher owns the persistent child home, cooldown, cache and deadline.
This module never discovers credentials or changes SDK access controls.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import html
import importlib.metadata
import io
import json
import math
from numbers import Integral, Real
import os
import re
import sys
from urllib.parse import urlsplit

VERSION = "4.0.7"
DATASETS = frozenset({"history", "company", "ratios", "income_statement", "balance_sheet", "cash_flow", "news", "events"})
STATEMENTS = frozenset({"income_statement", "balance_sheet", "cash_flow"})
MAX_INPUT_BYTES = 1024
MAX_OUTPUT_BYTES = 1_500_000
MAX_COLUMNS = 80
MAX_CELL_LENGTH = 2000
SYMBOL = re.compile(r"[A-Z][A-Z0-9]{2,7}\Z")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
PRICE_FIELDS = ("open", "high", "low", "close")
HISTORY_FIELDS = ("time", *PRICE_FIELDS, "volume")
SOURCE_URLS = {"KBS": "https://www.kbsec.com.vn/", "VCI": "https://www.vietcap.com.vn/"}
SOURCE_BY_DATASET = {"balance_sheet": "VCI", "cash_flow": "VCI"}


class AdapterError(Exception):
    def __init__(self, code="market_invalid_response"):
        self.code = code
        super().__init__(code)


class QuietStream(io.TextIOBase):
    """Discard SDK banners and background prints without unbounded buffering."""

    def write(self, value):
        return len(value)

    def flush(self):
        pass

    @property
    def encoding(self):
        return "utf-8"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def validate_input(value):
    if (not isinstance(value, dict) or set(value) != {"symbol", "dataset"}
            or not isinstance(value["symbol"], str) or not SYMBOL.fullmatch(value["symbol"])
            or not isinstance(value["dataset"], str) or value["dataset"] not in DATASETS):
        raise AdapterError()
    return dict(value)


def safe_text(value, maximum=MAX_CELL_LENGTH):
    value = CONTROL.sub("", ANSI.sub("", html.unescape(str(value))))
    value = re.sub(r"<[^>]{0,2000}>", " ", value)
    return re.sub(r"\s+", " ", value).strip()[:maximum]


def safe_link(value):
    value = safe_text(value)
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username or parsed.password):
            return None
        # Accessing port also rejects malformed URLs before UI delivery.
        parsed.port
    except ValueError:
        return None
    return value


def scalar(value, key=""):
    import pandas as pd

    if value is None:
        return None
    if isinstance(value, (list, dict, tuple, set)):
        # Nested provider payloads are not part of the flat table contract.
        return None
    try:
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bool):
        return value
    if isinstance(value, Integral):
        number = int(value)
        return number if abs(number) <= 2**53 - 1 else str(number)
    if isinstance(value, (Real, Decimal)):
        number = float(value)
        return number if math.isfinite(number) else None
    if hasattr(value, "item"):
        return scalar(value.item(), key)
    if isinstance(value, str):
        if re.search(r"(?:^|_)(?:url|link|website)(?:$|_)", key, re.I):
            return safe_link(value)
        return safe_text(value)
    return None


def normalized_date(value):
    """Parse explicit date values, never infer a date from an arbitrary number."""
    if isinstance(value, (datetime, date)):
        try:
            return date(value.year, value.month, value.day).isoformat()
        except (TypeError, ValueError):
            return None
    if not isinstance(value, str):
        return None
    value = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+Z-]+)?", value):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            return None
    for pattern in ("%d/%m/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            pass
    return None


def period_end(value):
    match = re.fullmatch(r"(20\d{2})(?:-Q([1-4]))?", str(value))
    if not match:
        return None
    year = int(match[1])
    month = int(match[2]) * 3 if match[2] else 12
    return date(year, month, calendar.monthrange(year, month)[1]).isoformat()


def column_specs(columns):
    used = set()
    result = []
    for index, column in enumerate(columns):
        parts = column if isinstance(column, tuple) else (column,)
        names = [safe_text(part, 120) for part in parts if part is not None and str(part) != "nan"]
        label = " / ".join(names)[:300]
        base = "__".join(names)[:180] or f"column_{index + 1}"
        if base in {"__proto__", "constructor", "prototype"}:
            base = f"column_{index + 1}"
        key = base
        suffix = 1
        while key in used:
            suffix += 1
            key = f"{base}__{suffix}"
        used.add(key)
        result.append({"key": key, "label": label or f"Column {index + 1}"})
    return result


def source_for(input_value, source=None):
    source = source or SOURCE_BY_DATASET.get(input_value["dataset"], "KBS")
    if source not in SOURCE_URLS:
        raise AdapterError()
    return source


def envelope(input_value, fetched_at, source=None):
    source = source_for(input_value, source)
    return {"schemaVersion": 1, "provider": "vnstock", "providerVersion": VERSION,
            "access": "guest", **input_value,
            "source": {"name": source, "url": SOURCE_URLS[source]},
            "fetchedAt": fetched_at, "asOf": None, "status": "empty",
            "columns": [], "rows": [], "units": {}}


def normalize_history(frame, packet):
    if len(frame) and (not set(HISTORY_FIELDS).issubset(frame.columns) or not frame.columns.is_unique):
        raise AdapterError()
    sessions = {}
    conflicts = set()
    invalid = duplicates = 0
    values_to_read = frame[list(HISTORY_FIELDS)].itertuples(index=False, name=None) if len(frame) else ()
    for values in values_to_read:
        session = normalized_date(values[0])
        numbers = [scalar(value) for value in values[1:]]
        if (session is None or session > packet["fetchedAt"][:10]
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in numbers)
                or any(value <= 0 for value in numbers[:4]) or numbers[4] < 0 or not float(numbers[4]).is_integer()
                or numbers[2] > min(numbers[:4]) or numbers[1] < max(numbers[:4])):
            invalid += 1
            continue
        row = dict(zip(HISTORY_FIELDS, (session, *numbers)))
        if session in sessions:
            duplicates += 1
            if sessions[session] != row:
                conflicts.add(session)
        else:
            sessions[session] = row
    rows = [sessions[key] for key in sorted(sessions) if key not in conflicts]
    packet["rows"] = rows[-300:]
    # The public interface can also accept index/futures-like symbols. Do not
    # assign equity currency units to instruments outside this verified scope.
    equity_price = bool(re.fullmatch(r"[A-Z]{3}", packet["symbol"]))
    packet["columns"] = [{"key": key, "label": key.title(), **({"unit": "VND_thousand" if equity_price else "unknown"} if key in PRICE_FIELDS else {"unit": "unknown"} if key == "volume" else {})} for key in HISTORY_FIELDS]
    # The current KBS SDK retains raw volume without a provider unit guarantee.
    packet["units"] = {"price": "thousand_vnd" if equity_price else "unknown", "volume": "unknown"}
    packet["asOf"] = packet["rows"][-1]["time"] if packet["rows"] else None
    packet["summary"] = {"totalRows": len(frame), "returnedRows": len(packet["rows"]),
                         "invalidRows": invalid, "duplicateRows": duplicates,
                         "conflictingDates": len(conflicts), "truncatedRows": max(0, len(rows) - 300),
                         "truncatedColumns": 0, "asOfKind": "market_session", "interval": "1D"}
    if len(frame) and not rows:
        raise AdapterError()


def normalize_table(frame, packet):
    import pandas as pd

    dataset = packet["dataset"]
    # Preserve meaningful row indexes before flattening MultiIndex columns.
    if not isinstance(frame.index, pd.RangeIndex) or frame.index.name:
        frame = frame.copy()
        names = [f"row_index_{index + 1}" for index in range(frame.index.nlevels)]
        while any(name in frame.columns for name in names):
            names = [f"_{name}" for name in names]
        frame.index.names = names
        frame = frame.reset_index()
    columns = column_specs(frame.columns[:MAX_COLUMNS])
    maximum = 200 if dataset in STATEMENTS or dataset == "ratios" else 50
    rows = []
    output_bytes = 0
    invalid_cells = 0
    for values in frame.iloc[:maximum, :MAX_COLUMNS].itertuples(index=False, name=None):
        row = {column["key"]: scalar(value, column["key"]) for column, value in zip(columns, values)}
        if dataset == "company":
            value = row.get("free_float_percentage")
            if isinstance(value, (int, float)) and not isinstance(value, bool) and not 0 <= value <= 100:
                row["free_float_percentage"] = None
                invalid_cells += 1
        size = len(json.dumps(row, ensure_ascii=False, allow_nan=False).encode("utf-8"))
        if output_bytes + size > 1_300_000:
            break
        output_bytes += size
        rows.append(row)
    packet["columns"] = columns
    packet["rows"] = rows
    packet["summary"] = {"totalRows": len(frame), "returnedRows": len(rows),
                         "truncatedRows": max(0, len(frame) - len(rows)),
                         "truncatedColumns": max(0, len(frame.columns) - len(columns)),
                         "invalidCells": invalid_cells, "asOfKind": "unknown"}
    periods = frame.attrs.get("periods", [])
    if isinstance(periods, list):
        periods = [safe_text(value, 100) for value in periods[:80]]
        packet["summary"]["periods"] = periods
    else:
        periods = []
    if dataset in STATEMENTS or dataset == "ratios":
        if not periods:
            # VCI's public report DataFrame has period columns but no attrs.
            periods = [str(column) for column in frame.columns if period_end(column)]
            packet["summary"]["periods"] = periods[:80]
        ends = [value for period in periods for value in [period_end(period)] if value]
        packet["asOf"] = max(ends) if ends else None
        packet["summary"]["asOfKind"] = "financial_period_end" if ends else "unknown"
        packet["units"] = {"values": "provider_normalized", "rowUnit": "provider_reported" if "unit" in frame.columns else "unknown"}
        # Preserve upstream annotations separately. The SDK already applies
        # its statement multiplier; applying it here again would corrupt values.
        for name in ("audit_status", "unit_type"):
            metadata = frame.attrs.get(name, {})
            if isinstance(metadata, dict):
                packet["summary"][name] = {safe_text(key, 100): scalar(value) for key, value in list(metadata.items())[:80]}
        packet["summary"]["adapterRescaledValues"] = False
    elif dataset == "company":
        references = [value for row in rows for value in [normalized_date(row.get("as_of_date"))] if value]
        packet["asOf"] = max(references) if references else None
        packet["summary"]["asOfKind"] = "reference_date" if references else "unknown"
    elif dataset == "news":
        published = []
        for row in rows:
            for key in ("published_at", "publish_time", "publish_date", "published_date", "public_date", "post_date", "news_date"):
                parsed = normalized_date(row.get(key))
                if parsed:
                    published.append(parsed)
        packet["asOf"] = max(published) if published else None
        packet["summary"]["asOfKind"] = "publication" if published else "unknown"


def normalize_frame(frame, input_value, fetched_at=None, source=None):
    import pandas as pd

    if not isinstance(frame, pd.DataFrame):
        raise AdapterError()
    source = source_for(input_value, source)
    for key, expected in (("symbol", input_value["symbol"]), ("source", source)):
        actual = frame.attrs.get(key)
        if actual is not None and str(actual).upper() != expected:
            raise AdapterError()
    packet = envelope(input_value, fetched_at or utc_now(), source)
    if input_value["dataset"] == "history":
        normalize_history(frame, packet)
    else:
        normalize_table(frame, packet)
    packet["status"] = "ready" if packet["rows"] else "empty"
    return packet


def call_sdk(input_value, source=None):
    try:
        if importlib.metadata.version("vnstock") != VERSION:
            raise AdapterError("market_sdk_incompatible")
    except importlib.metadata.PackageNotFoundError as error:
        raise AdapterError("market_sdk_missing") from error
    # Documented vnai 2.5.9 switches disable instruction-file setup only.
    os.environ.setdefault("VNSTOCK_DISABLE_AGENT_SETUP", "1")
    os.environ.setdefault("VNSTOCK_DISABLE_GLOBAL_AGENT", "1")
    from vnstock import Fundamental, Market, Reference

    symbol, dataset = input_value["symbol"], input_value["dataset"]
    source = source_for(input_value, source).lower()
    if dataset == "history":
        end = datetime.now(timezone.utc).date()
        return Market().equity(symbol).ohlcv(start=(end - timedelta(days=365)).isoformat(), end=end.isoformat(), interval="1D", count=300, source=source)
    if dataset in {"company", "news", "events"}:
        company = Reference().company(symbol)
        return getattr(company, "info" if dataset == "company" else dataset)(source=source)
    fundamental = Fundamental().equity(symbol)
    options = {"period": "quarter", "orient": "report", "source": source}
    if dataset == "ratios":
        options.update(display_mode="all", include_metadata=True)
    if source == "vci":
        options["dropna"] = False
    # vnai 2.5.9's official statement wrappers accept only period/show_log.
    # Keep their access/history controls intact and retain available df.attrs.
    return getattr(fundamental, "ratio" if dataset == "ratios" else dataset)(**options)


def error_code(error):
    if isinstance(error, AdapterError):
        return error.code
    name = type(error).__name__
    status = getattr(getattr(error, "response", None), "status_code", None)
    if name in {"RateLimitExceeded", "RateLimitError"} or status == 429:
        return "market_rate_limited"
    if name in {"Timeout", "ReadTimeout", "ConnectTimeout", "TimeoutError"}:
        return "market_timeout"
    if status in {401, 403} or name in {"PermissionError", "AuthenticationError", "AuthorizationError"}:
        return "market_access_denied"
    if isinstance(error, (ImportError, ModuleNotFoundError)):
        return "market_sdk_missing"
    return "market_provider_unavailable"


def unavailable(input_value, code):
    packet = envelope(input_value, utc_now())
    packet.update(status="unavailable", error={"code": code})
    return packet


def main():
    output = sys.stdout
    # Python -I deliberately ignores PYTHONIOENCODING/PYTHONUTF8. Windows pipe
    # encoding must therefore be set on this owned stream, including accents.
    if hasattr(output, "reconfigure"):
        output.reconfigure(encoding="utf-8", errors="strict")
    # Keep these redirected until process exit: SDK threads/atexit handlers may
    # print after the data method returns. Only this adapter writes the packet.
    sys.stdout = QuietStream()
    sys.stderr = QuietStream()
    input_value = {"symbol": "", "dataset": ""}
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise AdapterError()
        input_value = validate_input(json.loads(raw.decode("utf-8")))
        packet = normalize_frame(call_sdk(input_value), input_value)
    except (Exception, SystemExit) as error:
        packet = unavailable(input_value, error_code(error))
    serialized = json.dumps(packet, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if len(serialized.encode("utf-8")) > MAX_OUTPUT_BYTES:
        serialized = json.dumps(unavailable(input_value, "market_result_too_large"), ensure_ascii=False, separators=(",", ":"))
    output.write(serialized + "\n")
    output.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
