'use strict';

const NodeResque = require('node-resque');

class BlockedBy extends NodeResque.Plugin {
    async beforePerform() {
        const currentJobId = this.currentJobId();
        const blockingJobIds = this.blockingJobIds();
        const now = Math.round(new Date().getTime() / 1000);
        const timeout = now + this.lockTimeout() + 1;

        // need to go through blockingJobIds
        const getCallback = await this.queueObject.connection.redis.get(blockingJobIds, timeout);

        // proceed if not blocked
        if (!getCallback) {
            await this.queueObject.connection.redis.expire(currentJobId, this.lockTimeout());

            return true;
        }

        // re-enqueue current job
        await this.reEnqueue();

        return false;
    }

    async afterPerform() {
        const currentJobId = this.currentJobId();

        await this.queueObject.connection.redis.del(currentJobId);

        return true;
    }

    async reEnqueue() {
        await this.queueObject.enqueueIn(this.enqueueTimeout(), this.queue, this.func, this.args);
    }

    lockTimeout() {
        if (this.options.lockTimeout) {
            return this.options.lockTimeout;
        }

        return 3600; // in seconds
    }

    enqueueTimeout() {
        if (this.options.enqueueTimeout) {
            return this.options.enqueueTimeout;
        }

        return 1001; // in ms
    }

    currentJobId() {
        return 333;
    }

    blockingJobIds() {
        return [111, 222];
        // const flattenedArgs = JSON.stringify(this.args);
        //
        // return this.worker.connection.key('workerslock', this.func, this.queue, flattenedArgs);
    }
}

exports.BlockedBy = BlockedBy;
