// Tests that replay the official kit need data/ (not in the repo). On a fresh clone they're skipped with a reason.
import { test } from 'node:test';
import { kitAvailable } from '../src/kit.ts';

const REASON = 'kit data not in this checkout: see README, "Data"';
export const kitTest: typeof test = (kitAvailable() ? test : ((name: string, fn: any) => test(name, { skip: REASON }, fn))) as typeof test;
