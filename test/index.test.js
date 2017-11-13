'use strict';

const assert = require('chai').assert;
const EventEmitter = require('events').EventEmitter;
const mockery = require('mockery');
const sinon = require('sinon');
const util = require('util');

sinon.assert.expose(assert, { prefix: '' });

describe('Index Test', () => {
    const worker = 'abc';
    const pid = '111';
    const plugin = {};
    const result = 'result';
    const error = 'error';
    const verb = '+';
    const delay = '3ms';
    const workerId = 1;
    const job = { args: [{ buildId: 1 }] };
    const queue = 'testbuilds';
    const failure = 'failed';
    const updateConfig = { job, queue, workerId, failure };
    const requestOptions = {
        auth: { bearer: 'fake' },
        json: true,
        method: 'PUT',
        payload: { status: 'FAILURE' },
        uri: `foo.bar/v4/builds/${job.args[0].buildId}`
    };

    let mockJobs;
    let multiWorker;
    let scheduler;
    let nrMockClass;
    let spyMultiWorker;
    let spyScheduler;
    let winstonMock;
    let requestMock;
    let redisConfigMock;
    let index;
    let testWorker;
    let testScheduler;
    let supportFunction;
    let updateBuildStatusMock;
    let processExitMock;
    let mockRedis;
    let mockRedisObj;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        mockJobs = {
            start: sinon.stub()
        };
        multiWorker = function () {
            this.start = () => {};
            this.end = sinon.stub();
        };
        scheduler = function () {
            this.start = () => {};
            this.connect = () => {};
            this.end = sinon.stub();
        };
        util.inherits(multiWorker, EventEmitter);
        util.inherits(scheduler, EventEmitter);
        nrMockClass = {
            multiWorker,
            scheduler
        };
        spyMultiWorker = sinon.spy(nrMockClass, 'multiWorker');
        spyScheduler = sinon.spy(nrMockClass, 'scheduler');
        winstonMock = {
            info: sinon.stub(),
            error: sinon.stub()
        };
        requestMock = sinon.stub();
        updateBuildStatusMock = sinon.stub();
        processExitMock = sinon.stub();
        process.exit = processExitMock;
        redisConfigMock = {
            connectionDetails: 'mockRedisConfig',
            queuePrefix: 'mockQueuePrefix_'
        };
        mockRedisObj = {
            hget: sinon.stub().resolves('{"apiUri": "foo.bar", "token": "fake"}')
        };
        mockRedis = sinon.stub().returns(mockRedisObj);

        mockery.registerMock('ioredis', mockRedis);
        mockery.registerMock('./lib/jobs', mockJobs);
        mockery.registerMock('node-resque', nrMockClass);
        mockery.registerMock('winston', winstonMock);
        mockery.registerMock('request', requestMock);
        mockery.registerMock('./config/redis', redisConfigMock);

        // eslint-disable-next-line global-require
        index = require('../index.js');
        supportFunction = index.supportFunction;
        testWorker = index.multiWorker;
        testScheduler = index.scheduler;
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
        process.removeAllListeners('SIGTERM');
    });

    after(() => {
        mockery.disable();
    });

    describe('supportFunction', () => {
        it('logs correct message when successfully update build failure status', (done) => {
            requestMock.yieldsAsync(null, { statusCode: 200 });

            supportFunction.updateBuildStatus(updateConfig, (err) => {
                assert.calledWith(mockRedisObj.hget,
                    'mockQueuePrefix_buildConfigs', job.args[0].buildId);
                assert.calledWith(requestMock, requestOptions);
                assert.isNull(err);
                assert.calledWith(winstonMock.error,
                // eslint-disable-next-line max-len
                    `worker[${workerId}] ${job} failure ${queue} ${JSON.stringify(job)} >> successfully update build status: ${failure}`
                );
                done();
            });
        });

        it('logs correct message when fail to update build failure status', (done) => {
            const requestErr = new Error('failed to update');
            const response = {};

            requestMock.yieldsAsync(requestErr, response);

            supportFunction.updateBuildStatus(updateConfig, (err) => {
                assert.calledWith(requestMock, requestOptions);
                assert.strictEqual(err.message, 'failed to update');
                assert.calledWith(winstonMock.error,
                    // eslint-disable-next-line max-len
                    `worker[${workerId}] ${job} failure ${queue} ${JSON.stringify(job)} >> ${failure} ${requestErr} ${response}`
                );
                done();
            });
        });

        it('logs error and then end scheduler when it fails to end worker', (done) => {
            const expectedErr = new Error('failed');

            testWorker.end.callsArgWith(0, expectedErr);
            testScheduler.end.callsArgWith(0, null);

            supportFunction.shutDownAll(testWorker, testScheduler);
            assert.calledWith(winstonMock.error, `failed to end the worker: ${expectedErr}`);
            assert.calledOnce(testScheduler.end);
            assert.calledWith(processExitMock, 0);
            done();
        });

        it('logs error and exit with 128 when it fails to end scheduler', (done) => {
            const expectedErr = new Error('failed');

            testWorker.end.callsArgWith(0, null);
            testScheduler.end.callsArgWith(0, expectedErr);

            supportFunction.shutDownAll(testWorker, testScheduler);
            assert.calledWith(winstonMock.error, `failed to end the scheduler: ${expectedErr}`);
            assert.calledWith(processExitMock, 128);
            done();
        });

        it('exit with 0 when it successfully ends both scheduler and worker', (done) => {
            testWorker.end.callsArgWith(0, null);
            testScheduler.end.callsArgWith(0, null);

            supportFunction.shutDownAll(testWorker, testScheduler);
            assert.calledWith(processExitMock, 0);
            done();
        });
    });

    describe('event handler', () => {
        it('logs the correct message for worker', () => {
            testWorker.emit('start', workerId);
            assert.calledWith(winstonMock.info, `worker[${workerId}] started`);

            testWorker.emit('end', workerId);
            assert.calledWith(winstonMock.info, `worker[${workerId}] ended`);

            testWorker.emit('cleaning_worker', workerId, worker, pid);
            assert.calledWith(winstonMock.info, `cleaning old worker ${worker} pid ${pid}`);

            testWorker.emit('poll', workerId, queue);
            assert.calledWith(winstonMock.info, `worker[${workerId}] polling ${queue}`);

            testWorker.emit('job', workerId, queue, job);
            assert.calledWith(winstonMock.info,
                `worker[${workerId}] working job ${queue} ${JSON.stringify(job)}`);

            testWorker.emit('reEnqueue', workerId, queue, job, plugin);
            assert.calledWith(winstonMock.info,
                `worker[${workerId}] reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`);

            testWorker.emit('success', workerId, queue, job, result);
            assert.calledWith(winstonMock.info,
                `worker[${workerId}] ${job} success ${queue} ${JSON.stringify(job)} >> ${result}`);

            // Mock updateBuildStatus to assert params pass in for the function
            index.supportFunction.updateBuildStatus = updateBuildStatusMock;
            testWorker.emit('failure', workerId, queue, job, failure);
            assert.calledWith(updateBuildStatusMock, updateConfig);

            testWorker.emit('error', workerId, queue, job, error);
            assert.calledWith(winstonMock.error,
                `worker[${workerId}] error ${queue} ${JSON.stringify(job)} >> ${error}`);

            testWorker.emit('pause', workerId);
            assert.calledWith(winstonMock.info, `worker[${workerId}] paused`);

            testWorker.emit('internalError', error);
            assert.calledWith(winstonMock.error, error);

            testWorker.emit('multiWorkerAction', verb, delay);
            assert.calledWith(winstonMock.info,
                `*** checked for worker status: ${verb} (event loop delay: ${delay}ms)`);
        });

        it('logs the correct message for scheduler', () => {
            const state = 'mock state';
            const timestamp = 'mock timestamp';

            testScheduler.emit('start');
            assert.calledWith(winstonMock.info, 'scheduler started');

            testScheduler.emit('end');
            assert.calledWith(winstonMock.info, 'scheduler ended');

            testScheduler.emit('poll');
            assert.calledWith(winstonMock.info, 'scheduler polling');

            testScheduler.emit('master', state);
            assert.calledWith(winstonMock.info,
                `scheduler became master ${state}`);

            testScheduler.emit('error', error);
            assert.calledWith(winstonMock.info,
                `scheduler error >> ${error}`);

            testScheduler.emit('working_timestamp', timestamp);
            assert.calledWith(winstonMock.info,
                `scheduler working timestamp ${timestamp}`);

            testScheduler.emit('transferred_job', timestamp, job);
            assert.calledWith(winstonMock.info,
                `scheduler enqueuing job timestamp  >>  ${JSON.stringify(job)}`);
        });
    });

    describe('multiWorker', () => {
        it('is constructed correctly', () => {
            const expectedConfig = {
                connection: 'mockRedisConfig',
                queues: ['mockQueuePrefix_builds'],
                minTaskProcessors: 1,
                maxTaskProcessors: 10,
                checkTimeout: 1000,
                maxEventLoopDelay: 10,
                toDisconnectProcessors: true
            };

            assert.calledWith(spyMultiWorker, sinon.match(expectedConfig), sinon.match({
                start: mockJobs.start
            }));
        });

        it('shuts down worker and scheduler when received SIGTERM signal', (done) => {
            const shutDownAllMock = sinon.stub();

            index.supportFunction.shutDownAll = shutDownAllMock;

            process.once('SIGTERM', () => {
                assert.calledOnce(shutDownAllMock);
                done();
            });
            process.kill(process.pid, 'SIGTERM');
        });
    });

    describe('scheduler', () => {
        it('is constructed correctly', () => {
            const expectedConfig = {
                connection: 'mockRedisConfig'
            };

            assert.calledWith(spyScheduler, sinon.match(expectedConfig));
        });
    });
});
