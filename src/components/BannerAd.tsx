import React from 'react';

interface BannerAdProps {
  style?: object;
}

/**
 * Banner ad is disabled for local personal build.
 */
export const BannerAd: React.FC<BannerAdProps> = () => null;

export default BannerAd;
