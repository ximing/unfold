export type USegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** 分段圆点/描边色类名，如 concept / method */
  tone?: string;
};

export function USegmented<T extends string>(props: {
  value: T;
  options: USegmentedOption<T>[];
  ariaLabel?: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={props.ariaLabel}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`${option.tone ?? ''} ${props.value === option.value ? 'on' : ''}`.trim()}
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
        >
          <i aria-hidden />
          {option.label}
        </button>
      ))}
    </div>
  );
}
