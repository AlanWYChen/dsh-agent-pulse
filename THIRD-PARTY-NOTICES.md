# Third-party notices

## DeepSeek Harness working indicator

- The whale-tail SVG outline is adapted from `RunningWhaleTail` in `@deepseek-ai/dsh-client-ui-chat` 0.2.1-rc.2. The tail's CSS wiggle is authored for this plugin, not DeepSeek's original APNG animation.
- The working text and ellipsis use DeepSeek's native `TextShimmer` export from `@deepseek-ai/dsh-client-ui-primitives`, supplied by the DSH Web shell. Its shimmer animation, decorative-copy accessibility handling, and reduced-motion behavior are provided by DeepSeek, not reimplemented or bundled by this plugin. The previous custom bouncing-dot animation has been removed.

Upstream: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), [TextShimmer component](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-primitives/src/TextShimmer.tsx), and [TextShimmer styles](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-primitives/src/TextShimmer.module.css).

The upstream MIT notice is retained below.

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
