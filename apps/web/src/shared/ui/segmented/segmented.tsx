import './segmented.css';

export type USegmentedOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function USegmented(props: {
  options: USegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const count = Math.max(props.options.length, 1);
  const index = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.value),
  );
  return (
    <div className="useg" role="group" aria-label={props.ariaLabel}>
      <span
        className="useg-thumb"
        aria-hidden
        style={{
          width: `calc(${100 / count}% - 2px)`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === props.value ? 'on' : undefined}
          disabled={option.disabled}
          aria-pressed={option.value === props.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
