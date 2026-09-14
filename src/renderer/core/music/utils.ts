import { assertApiSupport } from '@renderer/store/utils'
import musicSdk from '@renderer/utils/musicSdk'
import { QUALITYS } from '@common/constants'
import { isLosslessOrAbove } from '@common/utils/tools'
import {
  // getOtherSource as getOtherSourceFromStore,
  // saveOtherSource as saveOtherSourceFromStore,
  getMusicUrl as getStoreMusicUrl,
  getPlayerLyric as getStoreLyric,
} from '@renderer/utils/ipc'
import { appSetting } from '@renderer/store/setting'
import { langS2T, toNewMusicInfo, toOldMusicInfo } from '@renderer/utils'
import { requestMsg } from '@renderer/utils/message'
import { apis } from '@renderer/utils/musicSdk/api-source'


const getOtherSourcePromises = new Map()
const otherSourceCache = new Map<LX.Music.MusicInfo | LX.Download.ListItem, LX.Music.MusicInfoOnline[]>()
export const existTimeExp = /\[\d{1,2}:.*\d{1,4}\]/

export const getOtherSource = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false): Promise<LX.Music.MusicInfoOnline[]> => {
  // if (!isRefresh && musicInfo.id) {
  //   const cachedInfo = await getOtherSourceFromStore(musicInfo.id)
  //   if (cachedInfo.length) return cachedInfo
  // }
  if (otherSourceCache.has(musicInfo)) return otherSourceCache.get(musicInfo)!
  let key: string
  let searchMusicInfo: {
    name: string
    singer: string
    source: string
    albumName: string
    interval: string
  }
  if ('progress' in musicInfo) {
    key = `local_${musicInfo.id}`
    searchMusicInfo = {
      name: musicInfo.metadata.musicInfo.name,
      singer: musicInfo.metadata.musicInfo.singer,
      source: musicInfo.metadata.musicInfo.source,
      albumName: musicInfo.metadata.musicInfo.meta.albumName,
      interval: musicInfo.metadata.musicInfo.interval ?? '',
    }
  } else {
    key = `${musicInfo.source}_${musicInfo.id}`
    searchMusicInfo = {
      name: musicInfo.name,
      singer: musicInfo.singer,
      source: musicInfo.source,
      albumName: musicInfo.meta.albumName,
      interval: musicInfo.interval ?? '',
    }
  }
  if (getOtherSourcePromises.has(key)) return getOtherSourcePromises.get(key)

  const promise = new Promise<LX.Music.MusicInfoOnline[]>((resolve, reject) => {
    let timeout: null | NodeJS.Timeout = setTimeout(() => {
      timeout = null
      reject(new Error('find music timeout'))
    }, 15_000)
    musicSdk.findMusic(searchMusicInfo).then((otherSource) => {
      if (otherSourceCache.size > 10) otherSourceCache.clear()
      const source = otherSource.map(toNewMusicInfo) as LX.Music.MusicInfoOnline[]
      otherSourceCache.set(musicInfo, source)
      resolve(source)
    }).catch(reject).finally(() => {
      if (timeout) clearTimeout(timeout)
    })
  }).then((otherSource) => {
    // if (otherSource.length) void saveOtherSourceFromStore(musicInfo.id, otherSource)
    return otherSource
  }).finally(() => {
    if (getOtherSourcePromises.has(key)) getOtherSourcePromises.delete(key)
  })
  getOtherSourcePromises.set(key, promise)
  return promise
}


export const buildLyricInfo = async(lyricInfo: MakeOptional<LX.Player.LyricInfo, 'rawlrcInfo'>): Promise<LX.Player.LyricInfo> => {
  if (!appSetting['player.isS2t']) {
    // @ts-expect-error
    if (lyricInfo.rawlrcInfo) return lyricInfo
    return { ...lyricInfo, rawlrcInfo: { ...lyricInfo } }
  }

  if (appSetting['player.isS2t']) {
    const tasks = [
      lyricInfo.lyric ? langS2T(lyricInfo.lyric) : Promise.resolve(''),
      lyricInfo.tlyric ? langS2T(lyricInfo.tlyric) : Promise.resolve(''),
      lyricInfo.rlyric ? langS2T(lyricInfo.rlyric) : Promise.resolve(''),
      lyricInfo.lxlyric ? langS2T(lyricInfo.lxlyric) : Promise.resolve(''),
    ]
    if (lyricInfo.rawlrcInfo) {
      tasks.push(lyricInfo.lyric ? langS2T(lyricInfo.lyric) : Promise.resolve(''))
      tasks.push(lyricInfo.tlyric ? langS2T(lyricInfo.tlyric) : Promise.resolve(''))
      tasks.push(lyricInfo.rlyric ? langS2T(lyricInfo.rlyric) : Promise.resolve(''))
      tasks.push(lyricInfo.lxlyric ? langS2T(lyricInfo.lxlyric) : Promise.resolve(''))
    }
    return Promise.all(tasks).then(([lyric, tlyric, rlyric, lxlyric, lyric_raw, tlyric_raw, rlyric_raw, lxlyric_raw]) => {
      const rawlrcInfo = lyric_raw ? {
        lyric: lyric_raw,
        tlyric: tlyric_raw,
        rlyric: rlyric_raw,
        lxlyric: lxlyric_raw,
      } : {
        lyric,
        tlyric,
        rlyric,
        lxlyric,
      }
      return {
        lyric,
        tlyric,
        rlyric,
        lxlyric,
        rawlrcInfo,
      }
    })
  }

  // @ts-expect-error
  return lyricInfo.rawlrcInfo ? lyricInfo : { ...lyricInfo, rawlrcInfo: { ...lyricInfo } }
}

export const getCachedLyricInfo = async(musicInfo: LX.Music.MusicInfo): Promise<LX.Player.LyricInfo | null> => {
  let lrcInfo = await getStoreLyric(musicInfo)
  // lrcInfo = {} as unknown as LX.Player.LyricInfo
  if (existTimeExp.test(lrcInfo.lyric)) {
    if (lrcInfo.tlyric != null) {
      // if (musicInfo.lrc.startsWith('\ufeff[id:$00000000]')) {
      //   let str = musicInfo.lrc.replace('\ufeff[id:$00000000]\n', '')
      //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, lxlyric: musicInfo.tlrc })
      // } else if (musicInfo.lrc.startsWith('[id:$00000000]')) {
      //   let str = musicInfo.lrc.replace('[id:$00000000]\n', '')
      //   commit('setLrc', { musicInfo, lyric: str, tlyric: musicInfo.tlrc, lxlyric: musicInfo.tlrc })
      // }

      if (lrcInfo.lxlyric == null) {
        switch (musicInfo.source) { // 以下源支持lxlyric 重新获取
          case 'kg':
          case 'kw':
          case 'mg':
          case 'wy':
          case 'tx':
            break
          default:
            return lrcInfo
        }
      } else if (lrcInfo.rlyric == null) {
        // 以下源支持 rlyric 重新获取
        if (!['wy', 'kg', 'tx'].includes(musicInfo.source)) return lrcInfo
      } else return lrcInfo
    }
    if (musicInfo.source == 'local') return lrcInfo
  }
  return null
}

export const getOnlineOtherSourceMusicUrlByLocal = async(musicInfo: LX.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  url: string
  quality: LX.Quality
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  const quality = '128k'

  const cachedUrl = await getStoreMusicUrl(musicInfo, quality)
  if (cachedUrl && !isRefresh) return { url: cachedUrl, quality, isFromCache: true }

  let reqPromise
  try {
    reqPromise = apis('local').getMusicUrl(toOldMusicInfo(musicInfo), null).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then(({ url }: { url: string }) => {
    return { url, quality, isFromCache: false }
  })
}

export const getOnlineOtherSourceLyricByLocal = async(musicInfo: LX.Music.MusicInfoLocal, isRefresh: boolean): Promise<{
  lyricInfo: LX.Music.LyricInfo
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  const lyricInfo = await getCachedLyricInfo(musicInfo)
  if (lyricInfo && !isRefresh) return { lyricInfo, isFromCache: true }

  let reqPromise
  try {
    reqPromise = apis('local').getLyric(toOldMusicInfo(musicInfo)).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return { lyricInfo, isFromCache: false }
  })
}

export const getOnlineOtherSourcePicByLocal = async(musicInfo: LX.Music.MusicInfoLocal): Promise<{
  url: string
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  let reqPromise
  try {
    reqPromise = apis('local').getPic(toOldMusicInfo(musicInfo)).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }

  return reqPromise.then((url: string) => {
    return { url }
  })
}

// 设置里可选的「优先播放的音质」
export const PLAY_QUALITYS: Array<{ value: LX.Quality, label: string }> = [
  { value: '128k', label: '128K' },
  { value: '320k', label: '320K' },
  { value: 'flac', label: 'Flac' },
  { value: 'flac24bit', label: 'Flac24bit' },
  { value: 'atmos', label: 'Atmos' },
  { value: 'master', label: 'Master' },
]

// 某音质获取失败时按「歌曲」记录下来，避免同一首歌在刷新/换源重试时反复白打请求。
// 绝不能按「源」记：一首歌取不到 master 不代表同源其他歌也取不到，
// 按源记会让整个源在本次会话里再也不尝试 master，
// 表现就是「设置里选了 Master，却只有第一首歌试过，之后都直接从 flac24bit 开始取」
const unsupportedQualitys = new Map<string, Set<LX.Quality>>()
const UNSUPPORTED_CACHE_MAX = 1000

export const clearUnsupportedQualitysCache = () => {
  unsupportedQualitys.clear()
}

const isQualityUnsupported = (musicId: string, quality: LX.Quality) => {
  return unsupportedQualitys.get(musicId)?.has(quality) ?? false
}

const markQualityUnsupported = (musicId: string, quality: LX.Quality) => {
  // 简单设个上限，避免长会话里无限增长
  if (unsupportedQualitys.size >= UNSUPPORTED_CACHE_MAX) unsupportedQualitys.clear()
  let set = unsupportedQualitys.get(musicId)
  if (!set) unsupportedQualitys.set(musicId, set = new Set())
  set.add(quality)
}

const isMasterQuality = (quality: LX.Quality) => quality == 'master' || quality == 'atmos'

/**
 * 计算实际要尝试获取的音质列表（按音质从高到低），获取失败时依次降级
 *
 * - 设置为 128K / 192K / 320K 时，始终按歌曲实际拥有的音质获取，不做 Master 映射
 * - 设置为 Atmos / Master 时，SQ 及以上的歌曲一律先按 Master 获取（乐观请求，失败再逐级降级）
 * - 设置为 Atmos / Master，但歌曲只有 HQ / 192K / 128K 时，没有无损可映射，按实际音质获取
 * - 设置为 Flac / Flac24bit 时，按所选音质获取（不会顺带升到 Master）
 */
export const getTryQualitys = (highQuality: LX.Quality, musicInfo: LX.Music.MusicInfoOnline): LX.Quality[] => {
  const qualitys = musicInfo.meta._qualitys
  if (!qualitys) return ['128k']

  // HQ 及以下音质一直按实际音质获取
  if (highQuality == '320k' || highQuality == '192k' || highQuality == '128k') {
    const list = QUALITYS.slice(QUALITYS.indexOf(highQuality)).filter(q => qualitys[q])
    return list.length ? list : ['128k']
  }

  // 只有设置为 Atmos / Master 时，SQ 及以上的歌曲才按 Master 获取；
  // HQ / 192K / 128K 的歌没有无损可映射，只能按实际音质。
  // isLosslessOrAbove 只认真实的 flac/flac24bit/ape/wav，因此被写入脏 master/atmos 的有损歌曲不会误走 Master。
  // 这里必须同时看设置：选了 Flac / Flac24bit 时按所选音质获取，不能顺带升到 Master
  const useMaster = (highQuality == 'master' || highQuality == 'atmos') && isLosslessOrAbove(qualitys)
  const startQuality: LX.Quality = useMaster ? 'master' : highQuality

  const list = QUALITYS.slice(QUALITYS.indexOf(startQuality)).filter(q => {
    // master / atmos 源可能未声明但实际支持，先乐观尝试，失败后再降级
    if (isMasterQuality(q)) return useMaster && !isQualityUnsupported(musicInfo.id, q)
    return !!qualitys[q]
  })
  if (list.length) return list

  // 所选音质高于歌曲实际拥有的音质（例如选了 Master 但只有 HQ），退回歌曲实际的最高音质
  const actualQualitys = QUALITYS.filter(q => qualitys[q])
  return actualQualitys.length ? actualQualitys : ['128k']
}

/**
 * 按音质优先级依次尝试获取歌曲URL，失败自动降级到下一档音质
 */
const tryGetMusicUrl = (musicInfo: LX.Music.MusicInfoOnline, tryQualitys: LX.Quality[]): Promise<{ url: string, quality: LX.Quality }> => {
  const tryNext = (index: number): Promise<{ url: string, quality: LX.Quality }> => {
    if (index >= tryQualitys.length) return Promise.reject(new Error('该歌曲没有可用的音质'))
    const targetQuality = tryQualitys[index]
    let reqPromise
    try {
      reqPromise = musicSdk[musicInfo.source].getMusicUrl(toOldMusicInfo(musicInfo), targetQuality).promise
    } catch (err: any) {
      reqPromise = Promise.reject(err)
    }
    return reqPromise.then(({ url, type }: { url: string, type: LX.Quality }) => {
      return { url, quality: type }
    }).catch((err: any) => {
      if (err.message == requestMsg.tooManyRequests) throw err
      console.log(`[quality] ${musicInfo.source} ${targetQuality} 获取失败，降级重试`, err.message)
      if (isMasterQuality(targetQuality)) markQualityUnsupported(musicInfo.id, targetQuality)
      return tryNext(index + 1)
    })
  }
  return tryNext(0)
}

/**
 * 依次检查各音质等级的URL缓存
 */
const getCachedMusicUrlByQualitys = async(musicInfo: LX.Music.MusicInfoOnline, tryQualitys: LX.Quality[]): Promise<{ url: string, quality: LX.Quality } | null> => {
  for (const targetQuality of tryQualitys) {
    const cachedUrl = await getStoreMusicUrl(musicInfo, targetQuality)
    if (cachedUrl) return { url: cachedUrl, quality: targetQuality }
  }
  return null
}

export const getOnlineOtherSourceMusicUrl = async({ musicInfos, quality, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  quality?: LX.Quality
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')

  let musicInfo: LX.Music.MusicInfoOnline | null = null
  let itemQualitys: LX.Quality[] = []
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    if (!assertApiSupport(musicInfo.source)) continue
    itemQualitys = quality ? [quality] : getTryQualitys(appSetting['player.playQuality'], musicInfo)
    if (!musicInfo.meta._qualitys || !itemQualitys.length) continue

    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo || !itemQualitys.length) throw new Error(window.i18n.t('toggle_source_failed'))
  const targetMusicInfo: LX.Music.MusicInfoOnline = musicInfo
  const targetQualitys = itemQualitys

  if (!isRefresh) {
    const cached = await getCachedMusicUrlByQualitys(targetMusicInfo, targetQualitys)
    if (cached) return { musicInfo: targetMusicInfo, url: cached.url, quality: cached.quality, isFromCache: true }
  }

  // retryedSource.includes(targetMusicInfo.source)
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return tryGetMusicUrl(targetMusicInfo, targetQualitys).then(({ url, quality: type }) => {
    return { musicInfo: targetMusicInfo, url, quality: type, isFromCache: false }
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    if (err.message == requestMsg.tooManyRequests) throw err
    console.log(err)
    return getOnlineOtherSourceMusicUrl({ musicInfos, quality, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线音乐URL
 */
export const handleGetOnlineMusicUrl = async({ musicInfo, quality, onToggleSource, isRefresh, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  quality?: LX.Quality
  isRefresh: boolean
  allowToggleSource: boolean
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  isFromCache: boolean
}> => {
  if (!await window.lx.apiInitPromise[0]) throw new Error('source init failed')
  // console.log(musicInfo.source)
  const tryQualitys = quality ? [quality] : getTryQualitys(appSetting['player.playQuality'], musicInfo)

  if (!isRefresh) {
    const cached = await getCachedMusicUrlByQualitys(musicInfo, tryQualitys)
    if (cached) return { musicInfo, url: cached.url, quality: cached.quality, isFromCache: true }
  }

  return tryGetMusicUrl(musicInfo, tryQualitys).then(({ url, quality: type }) => {
    return { musicInfo, url, quality: type, isFromCache: false }
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource || err.message == requestMsg.tooManyRequests) throw err
    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourceMusicUrl({
          musicInfos: [...otherSource],
          onToggleSource,
          quality,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}


export const getOnlineOtherSourcePicUrl = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) throw new Error(window.i18n.t('toggle_source_failed'))

  if (musicInfo.meta.picUrl && !isRefresh) return { musicInfo, url: musicInfo.meta.picUrl, isFromCache: true }

  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getPic(toOldMusicInfo(musicInfo))
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourcePicUrl({ musicInfos, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线歌曲封面
 */
export const handleGetOnlinePicUrl = async({ musicInfo, isRefresh, onToggleSource, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  url: string
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    reqPromise = musicSdk[musicInfo.source].getPic(toOldMusicInfo(musicInfo))
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  return reqPromise.then((url: string) => {
    return { musicInfo, url, isFromCache: false }
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err
    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourcePicUrl({
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}


export const getOnlineOtherSourceLyricInfo = async({ musicInfos, onToggleSource, isRefresh, retryedSource = [] }: {
  musicInfos: LX.Music.MusicInfoOnline[]
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  retryedSource?: LX.OnlineSource[]
}): Promise<{
  lyricInfo: LX.Music.LyricInfo | LX.Player.LyricInfo
  musicInfo: LX.Music.MusicInfoOnline
  isFromCache: boolean
}> => {
  let musicInfo: LX.Music.MusicInfoOnline | null = null
  // eslint-disable-next-line no-cond-assign
  while (musicInfo = (musicInfos.shift()!)) {
    if (retryedSource.includes(musicInfo.source)) continue
    retryedSource.push(musicInfo.source)
    // if (!assertApiSupport(musicInfo.source)) continue
    console.log('try toggle to: ', musicInfo.source, musicInfo.name, musicInfo.singer, musicInfo.interval)
    onToggleSource(musicInfo)
    break
  }
  if (!musicInfo) throw new Error(window.i18n.t('toggle_source_failed'))

  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo) return { musicInfo, lyricInfo, isFromCache: true }
  }

  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = (musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo)) as any).promise
  } catch (err: any) {
    reqPromise = Promise.reject(err)
  }
  // retryedSource.includes(musicInfo.source)
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      lyricInfo,
      musicInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
    // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch((err: any) => {
    console.log(err)
    return getOnlineOtherSourceLyricInfo({ musicInfos, onToggleSource, isRefresh, retryedSource })
  })
}

/**
 * 获取在线歌词信息
 */
export const handleGetOnlineLyricInfo = async({ musicInfo, onToggleSource, isRefresh, allowToggleSource }: {
  musicInfo: LX.Music.MusicInfoOnline
  onToggleSource: (musicInfo?: LX.Music.MusicInfoOnline) => void
  isRefresh: boolean
  allowToggleSource: boolean
}): Promise<{
  musicInfo: LX.Music.MusicInfoOnline
  lyricInfo: LX.Music.LyricInfo | LX.Player.LyricInfo
  isFromCache: boolean
}> => {
  // console.log(musicInfo.source)
  let reqPromise
  try {
    // TODO: remove any type
    reqPromise = (musicSdk[musicInfo.source].getLyric(toOldMusicInfo(musicInfo)) as any).promise
  } catch (err) {
    reqPromise = Promise.reject(err)
  }
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return reqPromise.then((lyricInfo: LX.Music.LyricInfo) => {
    return existTimeExp.test(lyricInfo.lyric) ? {
      musicInfo,
      lyricInfo,
      isFromCache: false,
    } : Promise.reject(new Error('failed'))
  }).catch(async(err: any) => {
    console.log(err)
    if (!allowToggleSource) throw err

    onToggleSource()
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    return getOtherSource(musicInfo).then(otherSource => {
      console.log('find otherSource', otherSource)
      if (otherSource.length) {
        return getOnlineOtherSourceLyricInfo({
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
          retryedSource: [musicInfo.source],
        })
      }
      throw err
    })
  })
}
