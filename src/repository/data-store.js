import fs from "node:fs/promises";

export class DataStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async read() {
    const raw = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(raw);
  }

  async write(data) {
    this.writeQueue = this.writeQueue.then(() =>
      fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8")
    );
    return this.writeQueue;
  }

  async update(mutator) {
    const data = await this.read();
    const result = await mutator(data);
    await this.write(data);
    return result;
  }
}
