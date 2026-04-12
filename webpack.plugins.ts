import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import webpack from 'webpack';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

/** Baked into the main bundle when you run `npm run package` / `make` with these env vars set (CI-friendly). */
const buildFeedbackWebhook =
  process.env.DESKOY_DISCORD_FEEDBACK_WEBHOOK_URL || process.env.DESKOY_FEEDBACK_WEBHOOK_URL || '';
const buildBugWebhook =
  process.env.DESKOY_DISCORD_BUG_WEBHOOK_URL || process.env.DESKOY_BUG_WEBHOOK_URL || '';

export const plugins = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
  }),
  new webpack.DefinePlugin({
    __DESKOY_BUILD_FEEDBACK_WEBHOOK__: JSON.stringify(buildFeedbackWebhook),
    __DESKOY_BUILD_BUG_WEBHOOK__: JSON.stringify(buildBugWebhook),
  }),
];
