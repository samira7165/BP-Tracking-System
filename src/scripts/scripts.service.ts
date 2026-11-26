import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SaveScriptDto } from './dto/save-script.dto';
import { Script } from './script.types';
import { ScriptsStore } from './scripts.store';

@Injectable()
export class ScriptsService {
  constructor(private readonly store: ScriptsStore) {}

  all(): Promise<Script[]> {
    return this.store.all();
  }

  active(): Promise<Script[]> {
    return this.store.active();
  }

  async get(id: string): Promise<Script> {
    const script = await this.store.get(id);
    if (!script) throw new NotFoundException(`Script ${id} not found`);
    return script;
  }

  async create(dto: SaveScriptDto): Promise<Script> {
    const now = new Date().toISOString();
    const script: Script = {
      id: randomUUID(),
      title: dto.title,
      text: dto.text,
      language: dto.language || undefined,
      active: dto.active ?? true,
      keywords: dto.keywords ?? [],
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insert(script);
    return script;
  }

  async update(id: string, dto: SaveScriptDto): Promise<Script> {
    const old = await this.get(id);
    const script: Script = {
      ...old,
      title: dto.title,
      text: dto.text,
      language: dto.language || undefined,
      active: dto.active ?? old.active,
      keywords: dto.keywords ?? old.keywords,
      updatedAt: new Date().toISOString(),
    };
    await this.store.update(script);
    return script;
  }

  /** Existing recordings keep their own copy of the script text. */
  async remove(id: string) {
    await this.get(id);
    await this.store.remove(id);
  }
}
