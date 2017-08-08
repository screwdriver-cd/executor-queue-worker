'use strict';

const NR = require('node-resque');
const asCallback = require('ascallback');
const connectionDetails = {
    pkg: 'ioredis',
    host: process.env.REDIS_HOST,
    password: process.env.REDIS_PASSWORD,
    port: process.env.REDIS_PORT,
    database: 0
};

/**
 * Construct an executor and call executor.start with the buildConfig
 * @method execute
 * @param  {Object}     config                      config passed in from executor-queue
 * @param  {Object}     config.executor             config for the executor
 * @param  {String}     config.executor.name        executor name
 * @param  {Object}     config.executor.options     options to pass into executor's constructor
 * @param  {Object}     config.buildConfig          buildConfig needed for executor.start
 */
function execute(config) {
    new Promise((resolve) => {
        if (config.executor.name === 'queue') {
            throw new Error('screwdriver-executor-queue is not a valid option');
        }
        // eslint-disable-next-line
        const ExecutorPlugin = require(`screwdriver-executor-${config.executor.name}`);
        const executor = new ExecutorPlugin(config.executor.options);

        resolve(executor);
    })
    .then(executor => executor.start(config.buildConfig));
}

const jobs = {
    start: {
        perform: (config, callback) =>
            asCallback(execute(config), (err) => {
                if (err) {
                    return callback(err);
                }

                return callback(null);
            })
    }
};

// eslint-disable-next-line new-cap
const multiWorker = new NR.multiWorker({
    connection: connectionDetails,
    queues: ['builds'],
    minTaskProcessors: 1,
    maxTaskProcessors: 10,
    checkTimeout: 1000,
    maxEventLoopDelay: 10,
    toDisconnectProcessors: true
}, jobs);

/* eslint-disable no-console */
multiWorker.on('start', workerId =>
    console.log(`worker[${workerId}] started`));
multiWorker.on('end', workerId =>
    console.log(`worker[${workerId}] ended`));
multiWorker.on('cleaning_worker', (workerId, worker, pid) =>
    console.log(`cleaning old worker ${worker} pid ${pid}`));
multiWorker.on('poll', (workerId, queue) =>
    console.log(`worker[${workerId}] polling ${queue}`));
multiWorker.on('job', (workerId, queue, job) =>
    console.log(`worker[${workerId}] working job ${queue} ${JSON.stringify(job)}}`));
multiWorker.on('reEnqueue', (workerId, queue, job, plugin) =>
    console.log(`worker[${workerId}] reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`));
multiWorker.on('success', (workerId, queue, job, result) =>
    console.log(`worker[${workerId}] ${job} success ${queue} ${JSON.stringify(job)} >> ${result}`));
multiWorker.on('failure', (workerId, queue, job, failure) =>
    console.error(`worker[${workerId}] ${job} failure ${queue}
        ${JSON.stringify(job)} >> ${failure}`));
multiWorker.on('error', (workerId, queue, job, error) =>
    console.error(`worker[${workerId}] error ${queue} ${JSON.stringify(job)} >> ${error}`));
multiWorker.on('pause', workerId =>
    console.log(`worker[${workerId}] paused`));

// multiWorker emitters
multiWorker.on('internalError', error =>
    console.error(error));
multiWorker.on('multiWorkerAction', (verb, delay) =>
    console.log(`*** checked for worker status: ${verb} (event loop delay: ${delay}ms)`));
/* eslint-disable no-console */

multiWorker.start();
