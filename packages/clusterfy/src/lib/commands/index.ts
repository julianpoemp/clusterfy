import { ClusterfyCommand } from './clusterfy-command';

export * from './clusterfy-command';
export * from './get-timestamp.command';
export * from './storage-retrieve.command';
export * from './storage-save.command';
export * from './worker-set-metadata.command';

export interface ClusterfyIPCCommands {
  storage_save: ClusterfyCommand;
  storage_retrieve: ClusterfyCommand;
  get_timestamp: ClusterfyCommand;
  worker_set_metadata: ClusterfyCommand;
}
