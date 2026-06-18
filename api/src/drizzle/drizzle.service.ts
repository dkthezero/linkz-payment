import { Injectable } from '@nestjs/common';
import { getDb } from '@linkz/database';

@Injectable()
export class DrizzleService {
  private _db = getDb();
  get db() { return this._db.db; }
  get client() { return this._db.client; }
}