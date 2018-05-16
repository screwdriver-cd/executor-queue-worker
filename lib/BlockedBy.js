'use strict';

const NodeResque = require('node-resque');

class BlockedBy extends NodeResque.Plugin {
    async beforePerform() {
        const { jobId, blockedBy } = this.args[0];
        const blockingJobKeys = await this.queueObject.connection.redis.mget(blockedBy);
        const blockingJobsRunning = blockingJobKeys.some(j => j !== null);

        // If any blocking job is running, then re-enqueue
        if (blockingJobsRunning) {
            await this.reEnqueue();

            return false;
        }

        // Register the curent job as running by setting key
        // Set expire time to take care of the case where
        // afterPerform failed to call and blocked jobs will be stuck forever
        await this.queueObject.connection.redis.set(jobId);
        await this.queueObject.connection.redis.expire(jobId, this.lockTimeout());

        // Proceed
        return true;
    }

    async afterPerform() {
        const { jobId } = await this.jobInfo();

        // Delete current job key
        await this.queueObject.connection.redis.del(jobId);

        return true;
    }

    async reEnqueue() {
        await this.queueObject.enqueueIn(this.enqueueTimeout(), this.queue, this.func, this.args);
    }

    lockTimeout() { // same as build timeout
        if (this.options.lockTimeout) {
            return this.options.lockTimeout;
        }

        return 7200; // in seconds
    }

    enqueueTimeout() {
        if (this.options.enqueueTimeout) {
            return this.options.enqueueTimeout;
        }

        return 1001; // in ms
    }
}

exports.BlockedBy = BlockedBy;
