import type { ButtonHTMLAttributes, ReactNode } from 'react';

type UButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'default' | 'ghost' | 'danger';
  size?: 'default' | 'big';
  children: ReactNode;
};

export function UButton({ variant = 'default', size = 'default', className = '', children, ...rest }: UButtonProps) {
  const names = ['btn'];
  if (variant !== 'default') names.push(variant);
  if (size === 'big') names.push('big');
  if (className !== '') names.push(className);
  return (
    <button type="button" className={names.join(' ')} {...rest}>
      {children}
    </button>
  );
}
