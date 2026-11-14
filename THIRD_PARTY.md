# Third-party data

## Public Suffix List

`src/lib/psl-data.js` is generated from the [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat)
(ICANN and private sections), converted to ASCII/punycode. The version and commit
are recorded at the top of the file.

The Public Suffix List is subject to the terms of the Mozilla Public License,
v. 2.0. A copy of the MPL is available at https://mozilla.org/MPL/2.0/.

Regenerate it with `npm run update-psl`.

No other third-party code is shipped in the extension. `puppeteer-core` is a
development dependency used only by the test and icon scripts.
