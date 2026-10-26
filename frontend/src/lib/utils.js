import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines class names with clsx and merges Tailwind utility conflicts via tailwind-merge.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
