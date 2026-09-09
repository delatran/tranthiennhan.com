import { Icon } from "../ui.jsx";
import { INVESTOR_INTENTS, investorCopy } from "./investorIntents.js";

export function InvestorIntents({ selected, onSelect, locale, disabled, sectorId }) {
  const copy = investorCopy(locale, sectorId);
  return (
    <fieldset className="ns-investor-intents" disabled={disabled}>
      <legend>{copy.chooseIntent}</legend>
      <div>
        {INVESTOR_INTENTS.map((intent) => {
          const item = copy.intents[intent];
          return (
            <label
              className={`ns-investor-intent${selected === intent ? " is-selected" : ""}`}
              key={intent}
            >
              <input
                type="radio"
                name="ns-investor-intent"
                value={intent}
                checked={selected === intent}
                onChange={() => onSelect(intent)}
              />
              <Icon name={item.icon} size={21} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <span className="ns-intent-check" aria-hidden="true">
                {selected === intent ? <Icon name="check" size={12} /> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
