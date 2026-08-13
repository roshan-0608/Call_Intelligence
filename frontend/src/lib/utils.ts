import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Standard class merge: later Tailwind utilities win over earlier conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
