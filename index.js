'use strict';

const NR = require('node-resque');

// SET UP THE CONNECTION
const connectionDetails = {
    pkg: 'ioredis',
    host: 'redishost',
    password: null,
    port: 1234,
    database: 0
};

// DEFINE YOUR WORKER TASKS
const jobs = {
    start: {
        plugins: ['jobLock', 'retry'],
        pluginOptions: {
            jobLock: {},
            retry: {
                retryLimit: 3,
                retryDelay: (1000 * 5)
            }
        },
        /* config looks like this
            executor:
                name: k8s-vm
                options:
                    kubernetes: ...
            buildConfig:
                apiUri:
                buildId:
                container:
                token:
         */
        perform: (config, callback) => {
            // eslint-disable-next-line
            const ExecutorPlugin = require(`screwdriver-executor-${config.executor.name}`);
            const executor = new ExecutorPlugin(config.executor.options);

            return executor.start(config.buildConfig)
            .then(() => callback(null))
            .catch(err => callback(err));
        }
    }
};

// START A WORKER
// eslint-disable-next-line
const worker = new NR.multiWorker({
    connection: connectionDetails,
    queues: ['builds'] },
    jobs);

worker.connect(() => {
    worker.workerCleanup(); // optional: cleanup any previous improperly shutdown workers on this host
    worker.start();
});

// REGESTER FOR EVENTS
worker.on('start', () => console.log(
    'worker started'));
worker.on('end', () => console.log(
    'worker ended'));
worker.on('cleaning_worker', (w, pid) => console.log(
    `cleaning old worker ${w} with pid ${pid}`));
worker.on('poll', queue => console.log(
    `worker polling ${queue}`));
worker.on('job', (queue, job) => console.log(
    `working job ${queue} ${JSON.stringify(job)}`));
worker.on('reEnqueue', (queue, job, plugin) => console.log(
    `reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`));
worker.on('success', (queue, job, result) => console.log(
    `job success ${queue} ${JSON.stringify(job)} >> ${result}`));
worker.on('failure', (queue, job, failure) => console.log(
    `job failure ${queue} ${JSON.stringify(job)} >> ${failure}`));
worker.on('error', (queue, job, error) => console.log(
    `error ${queue} ${JSON.stringify(job)} >> ${error}`));
worker.on('pause', () => console.log(
    'worker paused'));
