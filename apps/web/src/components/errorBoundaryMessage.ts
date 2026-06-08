/**
 * Normalizes an unknown thrown value into a human-readable message.
 * Kept in its own module so it can be unit-tested and so the ErrorBoundary
 * component file only exports a component (react-refresh friendly). (M1.2-a)
 */
export const formatErrorBoundaryMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return 'Došlo je do neočekivane greške.';
};
