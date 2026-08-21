/** Typed messages exchanged with persistent concept-clustering workers. */

export interface FileConceptInitializeSampleRequest {
  id: number;
  type: 'initialize-sample';
  vectors: ArrayBuffer;
  dimension: number;
}

export interface FileConceptBroadStepRequest {
  id: number;
  type: 'broad-step';
  centroids: ArrayBuffer;
  centroidCount: number;
}

export interface FileConceptBroadAssignmentsRequest {
  id: number;
  type: 'broad-assignments';
  centroids: ArrayBuffer;
  centroidCount: number;
}

export interface FileConceptTrainLocalRequest {
  id: number;
  type: 'train-local';
  vectors: ArrayBuffer;
  dimension: number;
  centroidCount: number;
  iterations: number;
  seed: number;
}

export interface FileConceptSetModelRequest {
  id: number;
  type: 'set-model';
  dimension: number;
  broadCentroids: ArrayBuffer;
  localCentroids: ArrayBuffer;
  localOffsets: ArrayBuffer;
}

export interface FileConceptAssignRequest {
  id: number;
  type: 'assign';
  vectors: ArrayBuffer;
  maximumMemberships: number;
}

export type FileConceptWorkerRequest =
  | FileConceptInitializeSampleRequest
  | FileConceptBroadStepRequest
  | FileConceptBroadAssignmentsRequest
  | FileConceptTrainLocalRequest
  | FileConceptSetModelRequest
  | FileConceptAssignRequest;

export interface FileConceptWorkerResponse {
  id: number;
  type:
    | 'initialized'
    | 'broad-step'
    | 'broad-assignments'
    | 'train-local'
    | 'model-set'
    | 'assign'
    | 'error';
  sums?: ArrayBuffer;
  counts?: ArrayBuffer;
  assignments?: ArrayBuffer;
  centroids?: ArrayBuffer;
  conceptIndexes?: ArrayBuffer;
  scores?: ArrayBuffer;
  error?: string;
}
