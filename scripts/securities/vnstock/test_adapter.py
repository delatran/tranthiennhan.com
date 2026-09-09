"""Offline normalization and process-boundary fixtures, not provider receipts."""

from datetime import datetime, timezone
import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pandas as pd

import adapter

FETCHED = "2026-09-07T08:00:00Z"


def packet(frame, dataset="company"):
    return adapter.normalize_frame(frame, {"symbol": "FPT", "dataset": dataset}, FETCHED, source="KBS")


def prices(rows):
    return pd.DataFrame(rows, columns=adapter.HISTORY_FIELDS)


class InputTests(unittest.TestCase):
    def test_input_is_closed_and_does_not_accept_arbitrary_provider_parameters(self):
        self.assertEqual(adapter.validate_input({"symbol": "FPT", "dataset": "history"}), {"symbol": "FPT", "dataset": "history"})
        for value in (None, [], {"symbol": "../FPT", "dataset": "history"},
                      {"symbol": "FPT", "dataset": []}, {"symbol": "FPT", "dataset": "private_gateway"},
                      {"symbol": "FPT", "dataset": "history", "source": "untrusted"}):
            with self.subTest(value=value), self.assertRaises(adapter.AdapterError):
                adapter.validate_input(value)

    def test_safe_errors_never_copy_provider_text(self):
        class HttpFailure(Exception):
            pass
        for status, expected in ((429, "market_rate_limited"), (403, "market_access_denied"), (500, "market_provider_unavailable")):
            error = HttpFailure("Fixture secret must never appear in response")
            error.response = type("Response", (), {"status_code": status})()
            self.assertEqual(adapter.error_code(error), expected)
        self.assertEqual(adapter.error_code(SystemExit("private message")), "market_provider_unavailable")
        self.assertEqual(adapter.error_code(TimeoutError("private URL")), "market_timeout")

    def test_default_source_contract_matches_success_empty_and_error_envelopes(self):
        expected = {"history": "KBS", "company": "KBS", "ratios": "KBS", "income_statement": "KBS",
                    "balance_sheet": "VCI", "cash_flow": "VCI", "news": "KBS", "events": "KBS"}
        for dataset, source in expected.items():
            value = {"symbol": "FPT", "dataset": dataset}
            with self.subTest(dataset=dataset):
                self.assertEqual(adapter.source_for(value), source)
                self.assertEqual(adapter.envelope(value, FETCHED)["source"]["name"], source)
                self.assertEqual(adapter.unavailable(value, "market_timeout")["source"]["name"], source)
                self.assertEqual(adapter.normalize_frame(pd.DataFrame(), value, FETCHED)["source"]["name"], source)

    def test_vci_dispatch_uses_one_public_method_and_preserves_missing_cells(self):
        # This offline call-contract fixture implements only the three public
        # Unified API entry points. It supplies no auth/tier/license machinery.
        for dataset in ("balance_sheet", "cash_flow"):
            calls = []
            returned = pd.DataFrame({"2026-Q2": [None, 0]})
            def method(**kwargs):
                calls.append(kwargs)
                return returned
            endpoint = SimpleNamespace(**{dataset: method})
            public = SimpleNamespace(Fundamental=lambda: SimpleNamespace(equity=lambda symbol: endpoint), Market=None, Reference=None)
            with self.subTest(dataset=dataset), patch.dict(adapter.sys.modules, {"vnstock": public}), patch.object(adapter.importlib.metadata, "version", return_value="4.0.7"):
                self.assertIs(adapter.call_sdk({"symbol": "FPT", "dataset": dataset}), returned)
                self.assertEqual(calls, [{"period": "quarter", "orient": "report", "source": "vci", "dropna": False}])

    def test_cli_catches_system_exit_and_emits_one_redacted_json_value(self):
        output = io.StringIO()
        stdin = io.TextIOWrapper(io.BytesIO(b'{"symbol":"FPT","dataset":"company"}'), encoding="utf-8")
        def unavailable_provider(_):
            print("SDK banner with fixture-private-value")
            raise SystemExit("SDK error with fixture-private-value")
        with patch.object(adapter.sys, "stdout", output), patch.object(adapter.sys, "stderr", io.StringIO()), patch.object(adapter.sys, "stdin", stdin), patch.object(adapter, "call_sdk", unavailable_provider):
            adapter.main()
        encoded = output.getvalue()
        result = json.loads(encoded)
        self.assertEqual(result["status"], "unavailable")
        self.assertNotIn("fixture-private-value", encoded)
        self.assertEqual(len(encoded.strip().splitlines()), 1)

    def test_cli_overrides_non_utf8_pipe_encoding_even_in_isolated_python_mode(self):
        encoded = io.BytesIO()
        output = io.TextIOWrapper(encoded, encoding="ascii")
        stdin = io.TextIOWrapper(io.BytesIO(b'{"symbol":"FPT","dataset":"company"}'), encoding="utf-8")
        frame = pd.DataFrame({"name": ["Công ty Cổ phần FPT"]})
        with patch.object(adapter.sys, "stdout", output), patch.object(adapter.sys, "stderr", io.StringIO()), patch.object(adapter.sys, "stdin", stdin), patch.object(adapter, "call_sdk", return_value=frame):
            adapter.main()
        result = json.loads(encoded.getvalue().decode("utf-8"))
        self.assertEqual(result["rows"][0]["name"], "Công ty Cổ phần FPT")


class HistoryTests(unittest.TestCase):
    def test_sorts_sessions_preserves_zero_volume_and_does_not_rescale_sdk_price(self):
        result = packet(prices([
            ["2026-09-04", 100, 103, 99, 101.5, 250000],
            [pd.Timestamp("2026-09-03"), 98, 101, 97, 100, 0],
        ]), "history")
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["asOf"], "2026-09-04")
        self.assertEqual(result["rows"][0]["volume"], 0)
        self.assertEqual(result["rows"][1]["close"], 101.5)
        self.assertEqual(result["units"], {"price": "thousand_vnd", "volume": "unknown"})

    def test_index_like_symbols_do_not_inherit_equity_price_units(self):
        frame = prices([["2026-09-04", 1500, 1505, 1499, 1501, 10]])
        result = adapter.normalize_frame(frame, {"symbol": "VNINDEX", "dataset": "history"}, FETCHED)
        self.assertEqual(result["units"]["price"], "unknown")

    def test_invalid_ohlcv_missing_numbers_and_future_sessions_cannot_enter_chart(self):
        result = packet(prices([
            ["2026-09-04", 100, 103, 99, 101, 10],
            ["2026-02-30", 100, 103, 99, 101, 10],
            ["2026-09-03", 100, 99, 98, 101, 10],
            ["2026-09-02", 100, 103, 99, float("inf"), 10],
            ["2026-09-01", 100, 103, 99, 101, None],
            ["2026-09-08", 100, 103, 99, 101, 10],
            ["2026-08-31", 100, 103, 99, 101, -1],
        ]), "history")
        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual(result["summary"]["invalidRows"], 6)
        with self.assertRaises(adapter.AdapterError):
            packet(prices([["2026-09-04", 0, 0, 0, 0, 0]]), "history")

    def test_exact_duplicates_collapse_but_conflicting_sessions_are_excluded(self):
        result = packet(prices([
            ["2026-09-04", 100, 103, 99, 101, 10],
            ["2026-09-04", 100, 103, 99, 101, 10],
            ["2026-09-03", 100, 103, 99, 101, 10],
            ["2026-09-03", 100, 103, 99, 102, 10],
        ]), "history")
        self.assertEqual([row["time"] for row in result["rows"]], ["2026-09-04"])
        self.assertEqual(result["summary"]["duplicateRows"], 2)
        self.assertEqual(result["summary"]["conflictingDates"], 1)

    def test_empty_history_stays_empty_instead_of_fabricating_a_quote(self):
        result = packet(pd.DataFrame(), "history")
        self.assertEqual((result["status"], result["asOf"], result["rows"]), ("empty", None, []))


class TableTests(unittest.TestCase):
    def test_zero_false_and_missing_are_distinct_and_json_is_finite(self):
        result = packet(pd.DataFrame({"number": pd.Series([0, None, float("inf"), pd.NA], dtype=object), "flag": [False, True, False, True]}))
        self.assertEqual([row["number"] for row in result["rows"]], [0, None, None, None])
        self.assertIs(result["rows"][0]["flag"], False)
        json.dumps(result, allow_nan=False)

    def test_impossible_company_ownership_percentage_is_missing_with_explicit_counter(self):
        result = packet(pd.DataFrame({"free_float_percentage": [17413264220000, 0, None, 100, 50]}))
        self.assertEqual([row["free_float_percentage"] for row in result["rows"]], [None, 0, None, 100, 50])
        self.assertEqual(result["summary"]["invalidCells"], 1)

    def test_vci_provenance_and_period_columns_do_not_inherit_kbs_attribution(self):
        frame = pd.DataFrame({"item": ["Total assets"], "2026-Q2": [42], "2026-Q1": [None]})
        result = adapter.normalize_frame(frame, {"symbol": "FPT", "dataset": "balance_sheet"}, FETCHED, source="VCI")
        self.assertEqual(result["source"], {"name": "VCI", "url": "https://www.vietcap.com.vn/"})
        self.assertEqual(result["asOf"], "2026-06-30")
        self.assertIsNone(result["rows"][0]["2026-Q1"])

    def test_financial_source_units_and_period_metadata_survive_without_double_scaling(self):
        frame = pd.DataFrame({"item": ["Total assets"], "unit": ["VND"], "2026-Q2": [4200000000000]})
        frame.attrs = {"symbol": "FPT", "source": "KBS", "periods": ["2026-Q2"], "audit_status": {"2026-Q2": "Reviewed"}, "unit_type": {"2026-Q2": "Thousand VND"}}
        result = packet(frame, "balance_sheet")
        self.assertEqual(result["rows"][0]["2026-Q2"], 4200000000000)
        self.assertEqual(result["rows"][0]["unit"], "VND")
        self.assertEqual(result["summary"]["unit_type"], {"2026-Q2": "Thousand VND"})
        self.assertIs(result["summary"]["adapterRescaledValues"], False)
        self.assertEqual(result["asOf"], "2026-06-30")
        self.assertEqual(result["summary"]["asOfKind"], "financial_period_end")

    def test_duplicate_multilevel_columns_flatten_deterministically_without_object_keys(self):
        frame = pd.DataFrame([[1, 2, 3]], columns=pd.MultiIndex.from_tuples([("valuation", "pe"), ("valuation", "pe"), ("__proto__", "")]))
        first = packet(frame)
        second = packet(frame)
        self.assertEqual(first, second)
        keys = [column["key"] for column in first["columns"]]
        self.assertEqual(len(set(keys)), 3)
        self.assertEqual(first["rows"][0][keys[1]], 2)
        unsafe = packet(pd.DataFrame([[1]], columns=["__proto__"]))
        self.assertEqual(unsafe["columns"][0]["key"], "column_1")

    def test_informative_row_index_is_not_lost(self):
        frame = pd.DataFrame({"pe": [12.5]}, index=pd.Index(["2026-Q2"], name="period"))
        result = packet(frame, "ratios")
        self.assertEqual(result["rows"][0]["row_index_1"], "2026-Q2")

    def test_row_column_and_text_bounds_are_explicit(self):
        frame = pd.DataFrame({f"field_{index}": ["x" * 5000] * 55 for index in range(85)})
        result = packet(frame)
        self.assertLessEqual(len(result["rows"]), 50)
        self.assertEqual(len(result["columns"]), 80)
        self.assertEqual(result["summary"]["truncatedColumns"], 5)
        self.assertEqual(result["summary"]["truncatedRows"], 55 - len(result["rows"]))
        self.assertLessEqual(len(json.dumps(result).encode()), adapter.MAX_OUTPUT_BYTES)

    def test_unsafe_links_nested_payloads_and_control_characters_do_not_reach_table(self):
        result = packet(pd.DataFrame({"title": ["<b>Company</b>\x00\x1b[31m result"], "news_url": ["javascript:alert(1)"], "website": ["https://user:password@example.com/"], "nested": [{"private": "nested"}]}), "news")
        self.assertEqual(result["rows"][0], {"title": "Company result", "news_url": None, "website": None, "nested": None})
        self.assertIsNone(adapter.safe_link("file:///C:/private.txt"))
        self.assertEqual(adapter.safe_link("https://example.com/report"), "https://example.com/report")
        self.assertEqual(adapter.safe_text("&lt;b&gt;Company&lt;/b&gt;"), "Company")
        self.assertNotIn("\x00", adapter.safe_text("&#0;Company"))

    def test_large_integers_remain_exact_strings_in_browser_json(self):
        value = 9007199254740993
        result = packet(pd.DataFrame({"amount": [value]}))
        self.assertEqual(result["rows"][0]["amount"], str(value))

    def test_wrong_symbol_or_provider_cannot_be_attached(self):
        for attrs in ({"symbol": "GMD"}, {"source": "OTHER"}):
            frame = pd.DataFrame({"value": [1]})
            frame.attrs = attrs
            with self.subTest(attrs=attrs), self.assertRaises(adapter.AdapterError):
                packet(frame)

    def test_fetch_time_is_not_misrepresented_as_source_publication_time(self):
        result = packet(pd.DataFrame({"title": ["Company notice"]}), "news")
        self.assertIsNone(result["asOf"])
        self.assertEqual(result["fetchedAt"], FETCHED)
        self.assertEqual(adapter.normalized_date(datetime(2026, 9, 4, 12, tzinfo=timezone.utc)), "2026-09-04")
        self.assertIsNone(adapter.normalized_date(20260904))

    def test_company_explicit_reference_date_is_distinct_from_fetch_time(self):
        source_date = "2025-12-31T00:00:00"
        result = packet(pd.DataFrame({"symbol": ["FPT"], "as_of_date": [source_date]}))
        self.assertEqual(result["asOf"], "2025-12-31")
        self.assertEqual(result["summary"]["asOfKind"], "reference_date")
        self.assertEqual(result["fetchedAt"], FETCHED)
        self.assertEqual(result["rows"][0]["as_of_date"], source_date)

    def test_company_does_not_infer_reference_date_from_listing_or_invalid_dates(self):
        for source_date in (None, "2025-02-30", "unknown", 20251231):
            with self.subTest(source_date=source_date):
                result = packet(pd.DataFrame({"as_of_date": [source_date], "listing_date": ["13/12/2006"]}))
                self.assertIsNone(result["asOf"])
                self.assertEqual(result["summary"]["asOfKind"], "unknown")


if __name__ == "__main__":
    unittest.main()
