import { contextBridge, ipcRenderer } from "electron";
import type { WorkflowSnapshot } from "./domain/contracts.js";

export interface WorkflowApi {
  getFixture(): Promise<WorkflowSnapshot>;
}

const workflowApi: WorkflowApi = {
  async getFixture(): Promise<WorkflowSnapshot> {
    return (await ipcRenderer.invoke("workflow:get-fixture")) as WorkflowSnapshot;
  },
};

contextBridge.exposeInMainWorld("workflowApi", workflowApi);
