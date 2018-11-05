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

    let mockJobs;
    let MultiWorker;
    let Scheduler;
    let nrMockClass;
    let winstonMock;
    let requestMock;
    let redisConfigMock;
    let index;
    let testWorker;
    let testScheduler;
    let helperMock;
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
        MultiWorker = sinon.stub();
        MultiWorker.prototype.start = () => {};
        MultiWorker.prototype.end = sinon.stub();

        Scheduler = sinon.stub();
        Scheduler.prototype.start = () => {};
        Scheduler.prototype.connect = async () => {};
        Scheduler.prototype.end = sinon.stub();

        util.inherits(MultiWorker, EventEmitter);
        util.inherits(Scheduler, EventEmitter);
        nrMockClass = {
            MultiWorker,
            Scheduler
        };
        winstonMock = {
            info: sinon.stub(),
            error: sinon.stub()
        };
        requestMock = sinon.stub();
        helperMock = {
            updateBuildStatus: sinon.stub()
        };
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
        mockery.registerMock('./lib/helper', helperMock);

        // eslint-disable-next-line global-require
        index = require('../index.js');
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

    describe('shutDownAll', () => {
        it('logs error and then end scheduler when it fails to end worker', async () => {
            const expectedErr = new Error('failed');

            testWorker.end = sinon.stub().rejects(expectedErr);
            testScheduler.end = sinon.stub().resolves(null);

            await index.shutDownAll(testWorker, testScheduler);
            assert.calledWith(winstonMock.error, `failed to end the worker: ${expectedErr}`);
            assert.calledOnce(testScheduler.end);
            assert.calledWith(processExitMock, 0);
        });

        it('logs error and exit with 128 when it fails to end scheduler', async () => {
            const expectedErr = new Error('failed');

            testWorker.end = sinon.stub().resolves(null);
            testScheduler.end = sinon.stub().rejects(expectedErr);

            await index.shutDownAll(testWorker, testScheduler);
            assert.calledWith(winstonMock.error, `failed to end the scheduler: ${expectedErr}`);
            assert.calledWith(processExitMock, 128);
        });

        it('exit with 0 when it successfully ends both scheduler and worker', async () => {
            testWorker.end.resolves();
            testScheduler.end.resolves();

            await index.shutDownAll(testWorker, testScheduler);
            assert.calledWith(processExitMock, 0);
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
                // eslint-disable-next-line max-len
                `worker[${workerId}] reEnqueue job (${JSON.stringify(plugin)}) ${queue} ${JSON.stringify(job)}`);

            testWorker.emit('success', workerId, queue, job, result);
            assert.calledWith(winstonMock.info,
                `worker[${workerId}] ${job} success ${queue} ${JSON.stringify(job)} >> ${result}`);

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

        /* Failure case is special because it needs to wait for the updateBuildStatus to finish then do worker logging.
         * We cannot guarantee the logs are executed sequentally because of event emitter.
         * Therefore, need to add a sleep after emit the event and assert afterward.
         */
        it('tests worker failure by some reason', async () => {
            const updateConfig = {
                buildId: 1,
                redisInstance: mockRedisObj,
                status: 'FAILURE',
                statusMessage: 'failure'
            };
            const sleep = async ms => new Promise(resolve => setTimeout(resolve, ms));
            const failure = 'failure';

            // When updateBuildStatus succeeds
            let errMsg = `worker[${workerId}] ${JSON.stringify(job)} failure ${queue} ` +
            `${JSON.stringify(job)} >> successfully update build status: ${failure}`;

            helperMock.updateBuildStatus.yieldsAsync(null, {});
            testWorker.emit('failure', workerId, queue, job, failure);
            await sleep(100);
            assert.calledWith(helperMock.updateBuildStatus, updateConfig);
            assert.calledWith(winstonMock.error, errMsg);

            // When updateBuildStatus fails
            const updateStatusError = new Error('failed');
            const response = { statusCode: 500 };

            errMsg = `worker[${workerId}] ${job} failure ${queue} ` +
            `${JSON.stringify(job)} >> ${failure} ${updateStatusError} ${JSON.stringify(response)}`;

            helperMock.updateBuildStatus.yieldsAsync(updateStatusError, { statusCode: 500 });
            testWorker.emit('failure', workerId, queue, job, failure);
            await sleep(100);
            assert.calledWith(helperMock.updateBuildStatus, updateConfig);
            assert.calledWith(winstonMock.error, errMsg);
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

            assert.calledWith(MultiWorker, sinon.match(expectedConfig), sinon.match({
                start: mockJobs.start
            }));
        });

        it('shuts down worker and scheduler when received SIGTERM signal', async () => {
            const shutDownAllMock = sinon.stub().resolves();

            index.shutDownAll = shutDownAllMock;

            process.once('SIGTERM', async () => {
                assert.calledOnce(shutDownAllMock);
            });
            process.kill(process.pid, 'SIGTERM');
        });
    });

    describe('scheduler', () => {
        it('is constructed correctly', () => {
            const expectedConfig = {
                connection: 'mockRedisConfig'
            };

            assert.calledWith(Scheduler, sinon.match(expectedConfig));
        });
    });
});
