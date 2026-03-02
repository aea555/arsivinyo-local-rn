export const SUPPORTED_PLATFORMS = [
  'youtube',
  'instagram',
  'facebook',
  'twitter',
  'reddit',
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export const SUPPORTED_PLATFORM_HOSTS: Record<SupportedPlatform, string[]> = {
  youtube: ['youtube.com', 'youtu.be'],
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.watch'],
  twitter: ['twitter.com', 'x.com'],
  reddit: ['reddit.com', 'v.redd.it'],
};
