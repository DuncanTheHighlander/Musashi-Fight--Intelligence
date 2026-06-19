/**
 * Taxonomy Seed Data — Structured martial arts knowledge for all disciplines.
 * Imports per-discipline data from seed files and combines them.
 */

import type { TechniqueCategory, TechniqueEntry, TechniqueSequence, TechniqueCounter } from './taxonomyService'
import { getBoxingData } from './seeds/boxing'
import { getMuayThaiData } from './seeds/muayThai'
import { getWrestlingData } from './seeds/wrestling'
import { getBjjData } from './seeds/bjj'
import { getMmaData } from './seeds/mma'
import { getJudoData } from './seeds/judo'
import { getKarateData } from './seeds/karate'
import { getTaekwondoData } from './seeds/taekwondo'
import { getKickboxingData } from './seeds/kickboxing'
import { getSumoData } from './seeds/sumo'
import { getSamboData } from './seeds/sambo'

export type CatSeed = Omit<TechniqueCategory, 'createdAt'>
export type EntrySeed = Omit<TechniqueEntry, 'createdAt' | 'updatedAt' | 'viewCount'>
export type SeqSeed = Omit<TechniqueSequence, 'createdAt'>
export type CounterSeed = Omit<TechniqueCounter, 'createdAt'>

export interface DisciplineSeedData {
  categories: CatSeed[]
  entries: EntrySeed[]
  sequences: SeqSeed[]
  counters: CounterSeed[]
}

/** Helper — generate deterministic IDs */
export const seedId = (prefix: string, name: string) =>
  `${prefix}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

/** Get all seed data combined */
export function getAllSeedData(): DisciplineSeedData {
  const all: DisciplineSeedData[] = [
    getBoxingData(),
    getMuayThaiData(),
    getWrestlingData(),
    getBjjData(),
    getMmaData(),
    getJudoData(),
    getKarateData(),
    getTaekwondoData(),
    getKickboxingData(),
    getSumoData(),
    getSamboData(),
  ]

  return {
    categories: all.flatMap(d => d.categories),
    entries: all.flatMap(d => d.entries),
    sequences: all.flatMap(d => d.sequences),
    counters: all.flatMap(d => d.counters),
  }
}
