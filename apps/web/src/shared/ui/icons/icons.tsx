type IconProps = { size?: number };

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    'aria-hidden': true as const,
  };
}

export function IconToday({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function IconSearch({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconPlus({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconStarMap({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="5.5" r="1.7" />
      <circle cx="5" cy="17.5" r="1.7" />
      <circle cx="19" cy="17.5" r="1.7" />
      <path d="M12 5.5 5 17.5M12 5.5l7 12M5 17.5h14" />
    </svg>
  );
}

export function IconMore({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export function IconClose({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconChevron({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconSidebar({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9.5 4v16" />
    </svg>
  );
}
