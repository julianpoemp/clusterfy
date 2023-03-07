import { ClusterfyShutdownCommand } from './shutdown.command';
import { ClusterfyStorageSaveCommand } from './storage-save.command';
import { ClusterfyStorageRetrieveCommand } from './storage-retrieve.command';
import { ClusterfyTimestampGetCommand } from './get-timestamp.command';
import { ClusterfyWorkerMetadataCommand } from './worker-set-metadata.command';

export * from './clusterfy-command';
export * from './get-timestamp.command';
export * from './storage-retrieve.command';
export * from './storage-save.command';
export * from './worker-set-metadata.command';
export * from './shutdown.command';

export interface ClusterfyIPCCommands {
  cy_storage_save: ClusterfyStorageSaveCommand;
  cy_storage_retrieve: ClusterfyStorageRetrieveCommand;
  cy_get_timestamp: ClusterfyTimestampGetCommand;
  cy_worker_set_metadata: ClusterfyWorkerMetadataCommand;
  cy_shutdown: ClusterfyShutdownCommand;
}
