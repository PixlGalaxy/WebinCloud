/**
 * Dotfiles such as .gitkeep, .env or .gitignore are ordinary content here, but
 * send() hides them by default and answers 404, which surfaces as a 500.
 */
export const SERVE_OPTIONS = { dotfiles: 'allow' } as const;
