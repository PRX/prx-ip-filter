# PRX IP Filter

[![license](https://img.shields.io/github/license/PRX/prx-ip-filter.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/prx-ip-filter.svg)](https://www.npmjs.com/package/prx-ip-filter)
[![npm](https://img.shields.io/npm/dt/prx-ip-filter.svg)](https://www.npmjs.com/package/prx-ip-filter)
[![build status](https://travis-ci.org/PRX/prx-ip-filter.svg?branch=master)](https://travis-ci.org/PRX/prx-ip-filter)

## Description

Utility for matching client IP addresses against a list of IP ranges.

This list can be built manually (by adding CIDRs and IP ranges) or loading from
an S3 location.

## Install

Just `npm install --save prx-ip-filter`.

## Usage

```node
const PrxIpFilter = require('prx-ip-filter');
const filter = new PrxIpFilter();

filter.addRange('1.1.1.1', '1.1.255.255', 'Some Datacenter');
filter.addRange('9:9:9:9::', '9:9:9:9:ffff:ffff:ffff:ffff', 'Something Else');

console.log(filter.check('1.1.99.99'));
# "Some Datacenter"
console.log(filter.check('9:9:9:9:abcd::'));
# "Something Else"
console.log(filter.check('1.2.1.1'));
# null
```

You can also serialize the current list of IP ranges to JSON, and load it from
JSON:

```node
filter.addRange('1.1.1.1', '1.1.255.255', 'Some Datacenter');
const json = JSON.stringify(filter);
console.log(json);
# "{"names":["Some Datacenter"],"ipv4":["001.001.001.001","001.001.255.255",0],"ipv6":[]}"

const filter2 = PrxIpFilter.fromJSON(json);
console.log(filter2.names);
# ["Some Datacenter"]

await filter.toFile('/path/to/filters.json');
const filter3 = await PrxIpFilter.fromFile('/path/to/filters.json');
console.log(filter3.names);
# ["Some Datacenter"]
```

Additionally, you can load load filters from 1 or more CSV files in S3, where
each line has the format `ipLow,ipHigh,name` or `cidr,name`:

```node
const filter = await PrxIpFilter.fromS3CSV('my-bucket-name', 'some-prefix-path');
```

## Development

Tests are run by Jest, and located in the `*.test.js` files. Write good tests.

## License

[MIT License](LICENSE)

## Contributing

1. Fork it
2. Create your feature branch (git checkout -b feat/my-new-feature)
3. Commit your changes (git commit -am 'Add some feature')
4. Push to the branch (git push origin feat/my-new-feature)
5. Create new Pull Request
