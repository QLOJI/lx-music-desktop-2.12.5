// 业务工具方法

import { MASTER_QUALITY_SOURCES } from '@common/constants'

export type QualityBadgeKey =
  | 'tag__master'
  | 'tag__atmos'
  | 'tag__lossless_24bit'
  | 'tag__lossless'
  | 'tag__high_quality'
  | 'tag__quality_192k'
  | 'tag__quality_128k'

/**
 * 列表音质小标，key 为小标的 i18n key，level 为配色等级
 */
export interface QualityBadge {
  key: QualityBadgeKey
  level: 'primary' | 'secondary' | 'tertiary'
}

// 各音质层级对应的小标文案与配色
const QUALITY_BADGES: Record<string, QualityBadge> = {
  master: { key: 'tag__master', level: 'primary' },
  atmos: { key: 'tag__atmos', level: 'primary' },
  flac24bit: { key: 'tag__lossless_24bit', level: 'primary' },
  flac: { key: 'tag__lossless', level: 'primary' },
  '320k': { key: 'tag__high_quality', level: 'secondary' },
  '192k': { key: 'tag__quality_192k', level: 'secondary' },
  '128k': { key: 'tag__quality_128k', level: 'tertiary' },
}

/**
 * 该歌曲是否属于 SQ（无损）及以上音质
 */
export const isLosslessOrAbove = (qualitys: LX.Music._MusicQualityType): boolean => {
  return !!(qualitys.master || qualitys.atmos || qualitys.flac24bit || qualitys.flac || qualitys.ape || qualitys.wav)
}

/**
 * 获取列表显示的单个音质小标
 * TX/KG/WY 的 SQ 及以上（flac/flac24bit）按需求统一显示为 Master
 * @param musicInfo
 */
export const getQualityBadge = (musicInfo: LX.Music.MusicInfo): QualityBadge | null => {
  if (!musicInfo || musicInfo.source == 'local') return null
  const qualitys = (musicInfo.meta as LX.Music.MusicInfoMeta_online)?._qualitys
  if (!qualitys) return null

  let quality: string | null = null
  // 必须先判 SQ：补齐音质时给 TX/KG/WY 的 SQ 及以上写了 master/atmos 别名，
  // 若先判 atmos 会导致这些歌曲的小标全部显示成 Atmos
  if (MASTER_QUALITY_SOURCES.includes(musicInfo.source) && (qualitys.flac24bit || qualitys.flac)) quality = 'master'
  else if (qualitys.atmos) quality = 'atmos'
  else if (qualitys.master) quality = 'master'
  else if (qualitys.flac24bit) quality = 'flac24bit'
  else if (qualitys.flac || qualitys.ape || qualitys.wav) quality = 'flac'
  else if (qualitys['320k']) quality = '320k'
  else if (qualitys['192k']) quality = '192k'
  else if (qualitys['128k']) quality = '128k'
  if (!quality) return null

  return QUALITY_BADGES[quality]
}

/**
 * 补齐音乐信息缺失的音质层级
 * TX/KG/WY 的 SQ 及以上补齐 master/atmos（沿用其无损码流信息），
 * 使这两个音质可以被选中、请求，并让小标覆盖完整音质层级
 * @param musicInfo
 */
export const fillMusicQualitys = (musicInfo: LX.Music.MusicInfo): LX.Music.MusicInfo => {
  if (!musicInfo || musicInfo.source == 'local') return musicInfo
  const meta = musicInfo.meta as LX.Music.MusicInfoMeta_online
  const qualitys = meta?._qualitys
  if (!qualitys || !Array.isArray(meta.qualitys)) return musicInfo

  if (MASTER_QUALITY_SOURCES.includes(musicInfo.source)) {
    const base = qualitys.flac24bit ?? qualitys.flac
    if (base) {
      if (!qualitys.master) {
        qualitys.master = { ...base }
        meta.qualitys.push({ type: 'master', size: base.size })
      }
      if (!qualitys.atmos) {
        qualitys.atmos = { ...base }
        meta.qualitys.push({ type: 'atmos', size: base.size })
      }
    }
  }

  return musicInfo
}

export const toNewMusicInfo = (oldMusicInfo: any): LX.Music.MusicInfo => {
  const meta: Record<string, any> = {
    songId: oldMusicInfo.songmid, // 歌曲ID，local为文件路径
    albumName: oldMusicInfo.albumName, // 歌曲专辑名称
    picUrl: oldMusicInfo.img, // 歌曲图片链接
  }
  const newInfo = {
    id: `${oldMusicInfo.source}_${oldMusicInfo.songmid}`,
    name: oldMusicInfo.name,
    singer: oldMusicInfo.singer,
    source: oldMusicInfo.source,
    interval: oldMusicInfo.interval,
    meta: meta as LX.Music.MusicInfoOnline['meta'],
  }

  if (oldMusicInfo.source == 'local') {
    meta.filePath = oldMusicInfo.filePath ?? oldMusicInfo.songmid ?? ''
    meta.ext = oldMusicInfo.ext ?? /\.(\w+)$/.exec(meta.filePath)?.[1] ?? ''
  } else {
    meta.qualitys = oldMusicInfo.types
    meta._qualitys = oldMusicInfo._types
    meta.albumId = oldMusicInfo.albumId
    if (meta._qualitys.flac32bit && !meta._qualitys.flac24bit) {
      meta._qualitys.flac24bit = meta._qualitys.flac32bit
      delete meta._qualitys.flac32bit

      meta.qualitys = (meta.qualitys as any[]).map(quality => {
        if (quality.type == 'flac32bit') quality.type = 'flac24bit'
        return quality
      })
    }

    switch (oldMusicInfo.source) {
      case 'kg':
        meta.hash = oldMusicInfo.hash
        meta.albumAudioId = oldMusicInfo.albumAudioId
        newInfo.id = oldMusicInfo.songmid + '_' + oldMusicInfo.hash
        break
      case 'tx':
        meta.strMediaMid = oldMusicInfo.strMediaMid
        meta.id = oldMusicInfo.songId
        meta.albumMid = oldMusicInfo.albumMid
        break
      case 'mg':
        meta.copyrightId = oldMusicInfo.copyrightId
        meta.lrcUrl = oldMusicInfo.lrcUrl
        meta.mrcUrl = oldMusicInfo.mrcUrl
        meta.trcUrl = oldMusicInfo.trcUrl
        break
    }
  }

  return fillMusicQualitys(newInfo as LX.Music.MusicInfo)
}

export const toOldMusicInfo = (minfo: LX.Music.MusicInfo) => {
  const oInfo: Record<string, any> = {
    name: minfo.name,
    singer: minfo.singer,
    source: minfo.source,
    songmid: minfo.meta.songId,
    interval: minfo.interval,
    albumName: minfo.meta.albumName,
    img: minfo.meta.picUrl ?? '',
    typeUrl: {},
  }
  if (minfo.source == 'local') {
    oInfo.filePath = minfo.meta.filePath
    oInfo.ext = minfo.meta.ext
    oInfo.albumId = ''
    oInfo.types = []
    oInfo._types = {}
  } else {
    oInfo.albumId = minfo.meta.albumId
    oInfo.types = minfo.meta.qualitys
    oInfo._types = minfo.meta._qualitys

    switch (minfo.source) {
      case 'kg':
        oInfo.hash = minfo.meta.hash
        oInfo.albumAudioId = minfo.meta.albumAudioId
        break
      case 'tx':
        oInfo.strMediaMid = minfo.meta.strMediaMid
        oInfo.albumMid = minfo.meta.albumMid
        oInfo.songId = minfo.meta.id
        break
      case 'mg':
        oInfo.copyrightId = minfo.meta.copyrightId
        oInfo.lrcUrl = minfo.meta.lrcUrl
        oInfo.mrcUrl = minfo.meta.mrcUrl
        oInfo.trcUrl = minfo.meta.trcUrl
        break
    }
  }

  return oInfo
}

/**
 * 修复2.0.0-dev.8之前的新列表数据音质
 * @param musicInfo
 */
export const fixNewMusicInfoQuality = (musicInfo: LX.Music.MusicInfo) => {
  if (musicInfo.source == 'local') return musicInfo

  // @ts-expect-error
  if (musicInfo.meta._qualitys.flac32bit && !musicInfo.meta._qualitys.flac24bit) {
    // @ts-expect-error
    musicInfo.meta._qualitys.flac24bit = musicInfo.meta._qualitys.flac32bit
    // @ts-expect-error
    delete musicInfo.meta._qualitys.flac32bit

    musicInfo.meta.qualitys = musicInfo.meta.qualitys.map(quality => {
      // @ts-expect-error
      if (quality.type == 'flac32bit') quality.type = 'flac24bit'
      return quality
    })
  }

  return fillMusicQualitys(musicInfo)
}

export const filterMusicList = <T extends LX.Music.MusicInfo>(list: T[]): T[] => {
  const ids = new Set<string>()
  return list.filter(s => {
    if (!s.id || ids.has(s.id) || !s.name) return false
    if (s.singer == null) s.singer = ''
    ids.add(s.id)
    return true
  })
}


const MAX_NAME_LENGTH = 80
const MAX_FILE_NAME_LENGTH = 150
export const clipNameLength = (name: string) => {
  if (name.length <= MAX_NAME_LENGTH || !name.includes('、')) return name
  const names = name.split('、')
  let newName = names.shift()!
  for (const name of names) {
    if (newName.length + name.length > MAX_NAME_LENGTH) break
    newName = newName + '、' + name
  }
  return newName
}
export const clipFileNameLength = (name: string) => {
  return name.length > MAX_FILE_NAME_LENGTH ? name.substring(0, MAX_FILE_NAME_LENGTH) : name
}

export const formatMusicName = (format: string, name: string, singer: string) => {
  // return format.replace(/歌名|歌手/g, match => match === '歌名' ? name : singer)
  return format.replace('歌手', singer).replace('歌名', name)
}
