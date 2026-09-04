/**
 * The icon set: hand-drawn 24x24 stroke paths on one grid, so weight and
 * terminal style stay consistent. Icons are decorative here - every one sits
 * beside a text label or inside a button that carries its own aria-label - so
 * they are marked aria-hidden and never carry meaning on their own.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const PencilIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />
    <path d="M13.5 7.5 16.5 10.5" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 12h10l1-12" />
    <path d="M10 11v5M14 11v5" />
  </Icon>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 5 8 12l7 7" />
  </Icon>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6 18 18M18 6 6 18" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4 2.5 20h19L12 4Z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Icon>
);

export const SignOutIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 4H5v16h4" />
    <path d="M15 8l4 4-4 4M19 12H10" />
  </Icon>
);

/** The empty-state mark: an unruled ledger sheet. */
export const SheetIcon = (props: IconProps) => (
  <Icon size={40} strokeWidth={1.25} {...props}>
    <path d="M5 3h9l5 5v13H5V3Z" />
    <path d="M14 3v5h5" />
    <path d="M8 12h8M8 15.5h8M8 19h5" />
  </Icon>
);

/** The chart empty-state mark: axes with no series. */
export const AxesIcon = (props: IconProps) => (
  <Icon size={40} strokeWidth={1.25} {...props}>
    <path d="M5 4v16h15" />
    <path d="M8.5 20v-3M12.5 20v-5M16.5 20v-2" opacity="0.5" />
  </Icon>
);

export const TargetIcon = (props: IconProps) => (
  <Icon size={40} strokeWidth={1.25} {...props}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
  </Icon>
);
