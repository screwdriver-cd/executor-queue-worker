'use strict';

const NodeResque = require('node-resque');
const { runningJobsPrefix } = require('../config/redis');

class BlockedBy extends NodeResque.Plugin {
    /**
     * Checks if there are any blocking jobs running. If yes, re-enqueue
     * If no, set the current job ID as key
     * @method beforePerform
     * @return {Promise}
     */
    async beforePerform() {
        const { jobId, blockedBy } = this.args[0];
        const blockingJobKeys = await this.queueObject.connection.redis.mget(blockedBy);
        const blockingJobsRunning = blockingJobKeys.some(j => j !== null);
        const key = `${runningJobsPrefix}${jobId}`;

        // If any blocking job is running, then re-enqueue
        if (blockingJobsRunning) {
            await this.reEnqueue();

            return false;
        }

        // Register the curent job as running by setting key
        // Set expire time to take care of the case where
        // afterPerform failed to call and blocked jobs will be stuck forever
        await this.queueObject.connection.redis.set(key, true);
        await this.queueObject.connection.redis.expire(key, this.lockTimeout());

        // Proceed
        return true;
    }

    /**
     * Returns true to proceed
     * @method afterPerform
     * @return {Promise}
     */
    async afterPerform() {
        return true;
    }

    /**
     * Re-enqueue in "reenqueueWaitTime"
     * @method reEnqueue
     * @return {Promise}
     */
    async reEnqueue() {
        await this.queueObject.enqueueIn(
            this.reenqueueWaitTime() * 1000, this.queue, this.func, this.args);
    }

    lockTimeout() { // same as build timeout
        if (this.options.lockTimeout) {
            return this.options.lockTimeout;
        }

        return 7200; // in seconds
    }

    reenqueueWaitTime() {
        if (this.options.reenqueueWaitTime) {
            return this.options.reenqueueWaitTime;
        }

        return 300; // in seconds
    }
}

exports.BlockedBy = BlockedBy;
