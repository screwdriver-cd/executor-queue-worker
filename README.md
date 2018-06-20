# Screwdriver Queue Worker
[![Version][npm-image]][npm-url] ![Downloads][downloads-image] [![Build Status][status-image]][status-url] [![Open Issues][issues-image]][issues-url] [![Dependency Status][daviddm-image]][daviddm-url] ![License][license-image]

> Creates executor queue worker(s)

A Resque Worker implementation that consumes jobs in a Resque queue.

## Usage

```bash
npm install screwdriver-queue-worker
```

## Configuration

Queue worker already [defaults most configuration](config/default.yaml), but you can override defaults using a `local.yaml` or environment variables using [custom-environment-variables.yaml](config/custom-environment-variables.yaml).

### Methods

#### Start
##### Required Parameters
| Parameter        | Type  |  Description |
| :-------------   | :---- | :-------------|
| config             | Object | Configuration Object |
| config.annotations | Object | Optional key-value object |
| config.apiUri      | String | Screwdriver's API |
| config.buildId     | String | The unique ID for a build |
| config.container   | String | Container for the build to run in |
| config.token       | String | JWT to act on behalf of the build |
| config.jobId       | String | Job that this build belongs to|
| config.blockedBy   | String | Jobs that are blocking this job |

##### Expected Outcome
The start function is expected to create a build in the designated execution engine.

##### Expected Return
A callback of `fn(err, result)`, where `err` is an Error that was encountered (if any) and `result`
is the data that the execution engine returns.

#### Stop
##### Required Parameters
| Parameter        | Type  |  Description |
| :-------------   | :---- | :-------------|
| config             | Object | Configuration Object |
| config.annotations | Object | Optional key-value object |
| config.buildId     | String | The unique ID for a build |
| config.jobId       | String | Job that this build belongs to|
| config.blockedBy   | String | Jobs that are blocking this job |

##### Expected Outcome
The stop function is expected to stop/cleanup a task in the desginated execution engine.

##### Expected Return
A callback of `fn(err, result)`, where `err` is an Error that was encountered (if any) and `result`
is the data that the execution engine returns.

## Testing

```bash
npm test
```

## License

Code licensed under the BSD 3-Clause license. See LICENSE file for terms.

[executor-base-class]: https://github.com/screwdriver-cd/executor-base
[npm-image]: https://img.shields.io/npm/v/screwdriver-executor-queue-worker.svg
[npm-url]: https://npmjs.org/package/screwdriver-executor-queue-worker
[downloads-image]: https://img.shields.io/npm/dt/screwdriver-executor-queue-worker.svg
[license-image]: https://img.shields.io/npm/l/screwdriver-executor-queue-worker.svg
[issues-image]: https://img.shields.io/github/issues/screwdriver-cd/executor-queue-worker.svg
[issues-url]: https://github.com/screwdriver-cd/executor-queue-worker/issues
[status-image]: https://cd.screwdriver.cd/pipelines/301/badge
[status-url]: https://cd.screwdriver.cd/pipelines/301
[daviddm-image]: https://david-dm.org/screwdriver-cd/executor-queue-worker.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/screwdriver-cd/executor-queue-worker
