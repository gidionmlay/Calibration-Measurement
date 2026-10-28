import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-hover disabled:bg-shade disabled:text-sub',
  secondary: 'border border-line bg-panel text-ink hover:bg-fill disabled:text-faint disabled:hover:bg-panel',
  ghost: 'text-ink hover:bg-fill disabled:text-faint'
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm'
};

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}>
      
      {icon}
      {children}
      {iconRight}
    </button>);

}