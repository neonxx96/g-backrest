import React from 'react';

export function SectionHeader({ className = '', children, ...props }) {
  return (
    <div
      className={`text-[12px] uppercase tracking-wider text-muted-foreground font-semibold select-none ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export default SectionHeader;
