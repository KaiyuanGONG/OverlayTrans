import { describe, expect, it } from "vitest";
import license from "../../LICENSE?raw";
import readme from "../../README.md?raw";
import readmeZhCn from "../../README.zh-CN.md?raw";
import trademarks from "../../TRADEMARKS.md?raw";

const canonicalMitLicense = `MIT License

Copyright (c) 2026 Kaiyuan GONG

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
`;

describe("project license policy", () => {
  it("keeps the root LICENSE as the canonical MIT text only", () => {
    expect(license.replace(/\r\n/g, "\n")).toBe(canonicalMitLicense);
  });

  it("keeps brand restrictions in the dedicated policy and links it from both READMEs", () => {
    expect(trademarks).toContain("The MIT License does not grant permission");
    expect(trademarks).toContain("Brand assets are © 2026 Kaiyuan GONG. All rights reserved.");
    expect(readme).toContain("[Trademark and Brand Policy](TRADEMARKS.md)");
    expect(readmeZhCn).toContain("[商标与品牌政策](TRADEMARKS.md)");
  });
});
