import { BYO_VENDOR_NAMES } from '../../../src/config';
import { BYO_VENDORS, type ByoVendor } from '../../../src/config-network';

/** Whose key it is: one vendor of BYO_VENDOR_NAMES. */
export function VendorChoice({
  vendor,
  choose,
}: {
  readonly vendor: ByoVendor;
  readonly choose: (vendor: ByoVendor) => void;
}) {
  return (
    <fieldset class="flex gap-4 text-sm">
      <legend class="sr-only">Whose key</legend>
      {BYO_VENDOR_NAMES.map((name) => (
        <label key={name} class="flex items-center gap-1">
          <input
            type="radio"
            name="byo-vendor"
            checked={vendor === name}
            onChange={() => {
              choose(name);
            }}
          />
          {BYO_VENDORS[name].label}
        </label>
      ))}
    </fieldset>
  );
}
