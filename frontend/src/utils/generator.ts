import { parse, stringify } from 'yaml'

import { Readfile, Writefile } from '@/utils/bridge'
import { deepClone, ignoredError, APP_TITLE, sampleID } from '@/utils'
import { KernelConfigFilePath, ProxyGroup } from '@/constant/kernel'
import { type ProfileType, useSubscribesStore, useRulesetsStore } from '@/stores'

export const generateRule = (rule: ProfileType['rulesConfig'][0]) => {
  const { type, payload, proxy, 'no-resolve': noResolve } = rule
  let ruleStr = type
  if (type !== 'MATCH') {
    if (type === 'RULE-SET') {
      const rulesetsStore = useRulesetsStore()
      const ruleset = rulesetsStore.getRulesetById(payload)
      if (ruleset) {
        ruleStr += ',' + ruleset.name
      }
    } else {
      ruleStr += ',' + payload
    }
  }
  ruleStr += ',' + proxy
  if (noResolve) {
    ruleStr += ',no-resolve'
  }
  return ruleStr
}

type ProxiesType = { type: string; name: string }

export const generateProxies = async (groups: ProfileType['proxyGroupsConfig']) => {
  const subscribesStore = useSubscribesStore()

  const subIDsMap = new Set(
    groups.reduce(
      (p, c) => [
        ...p,
        ...c.proxies.filter(({ type }) => type !== 'Built-In').map(({ type }) => type)
      ],
      [] as string[]
    )
  )

  const proxyMap: Record<string, ProxiesType[]> = {}

  for (const subID of subIDsMap) {
    const sub = subscribesStore.getSubscribeById(subID)
    if (sub) {
      try {
        const subStr = await Readfile(sub.path)
        const { proxies = [] } = parse(subStr)
        proxyMap[sub.id] = proxies
      } catch (error) {
        console.log(error)
      }
    }
  }

  const proxies = groups.reduce((p, c) => [...p, ...c.proxies], [] as ProxiesType[])

  const proxiesList: any = []

  proxies.forEach(({ type, name }) => {
    if (proxyMap[type]) {
      const proxy = proxyMap[type].find((v) => v.name === name)
      if (proxy) {
        const isExist = proxiesList.find((v: any) => v.name === proxy.name)
        !isExist && proxiesList.push(proxy)
        // TODO: Handle proxy with the same name
      }
    }
  })

  return proxiesList
}

export const generateProxyGroup = (proxyGruoup: ProfileType['proxyGroupsConfig'][0]) => {
  const {
    type,
    name,
    url,
    proxies,
    use,
    interval,
    strategy,
    tolerance,
    lazy,
    'disable-udp': disableUDP,
    filter
  } = proxyGruoup

  const group: any = { name, type, filter }

  if (use.length !== 0) {
    group.use = use
  }

  if (proxies.length !== 0) {
    group.proxies = proxies.map((v) => v.name)
  }

  if (type === ProxyGroup.Select) {
    Object.assign(group, {
      'disable-udp': disableUDP
    })
  } else if (type === ProxyGroup.UrlTest) {
    Object.assign(group, {
      url,
      interval,
      tolerance,
      lazy,
      'disable-udp': disableUDP
    })
  } else if (type === ProxyGroup.Fallback) {
    Object.assign(group, {
      url,
      interval,
      lazy,
      'disable-udp': disableUDP
    })
  } else if (type === ProxyGroup.LoadBalance) {
    Object.assign(group, {
      url,
      interval,
      lazy,
      'disable-udp': disableUDP,
      strategy
    })
  } else if (type === ProxyGroup.Relay) {
    Object.assign(group, {})
  }

  return group
}

export const generateProxyProviders = async (groups: ProfileType['proxyGroupsConfig']) => {
  const providers: Record<string, any> = {}
  const subs = new Set<string>()
  groups.forEach((group) => {
    group.use.forEach((use) => subs.add(use))
  })
  const subscribesStore = useSubscribesStore()
  subs.forEach((id) => {
    const sub = subscribesStore.getSubscribeById(id)
    if (sub) {
      providers[sub.name] = {
        type: 'file',
        path: sub.path.replace('data/', '../'),
        'health-check': {
          enable: true,
          lazy: true,
          url: 'https://www.gstatic.com/generate_204',
          interval: 300
        }
      }
    }
  })

  return providers
}

const generateRuleProviders = async (rules: ProfileType['rulesConfig']) => {
  const rulesetsStore = useRulesetsStore()
  const providers: Record<string, any> = {}
  rules
    .filter((rule) => rule.type === 'RULE-SET')
    .forEach((rule) => {
      const ruleset = rulesetsStore.getRulesetById(rule.payload)
      if (ruleset) {
        providers[ruleset.name] = {
          type: 'file',
          behavior: ruleset.behavior,
          path: ruleset.path.replace('data/', '../'),
          interval: ruleset.interval,
          format: ruleset.format
        }
      }
    })
  return providers
}

export const generateConfig = async (profile: ProfileType) => {
  profile = deepClone(profile)

  const config: Record<string, any> = {
    ...profile.generalConfig,
    ...profile.advancedConfig,
    tun: profile.tunConfig,
    dns: profile.dnsConfig
  }

  if (config.dns['default-nameserver'].length === 0) {
    delete config.dns['default-nameserver']
  }

  if (config.dns['nameserver'].length === 0) {
    delete config.dns['nameserver']
  }

  config['proxy-providers'] = await generateProxyProviders(profile.proxyGroupsConfig)

  config['rule-providers'] = await generateRuleProviders(profile.rulesConfig)

  config['proxies'] = await generateProxies(profile.proxyGroupsConfig)

  config['proxy-groups'] = profile.proxyGroupsConfig.map((proxyGruoup) =>
    generateProxyGroup(proxyGruoup)
  )

  config['rules'] = profile.rulesConfig
    .filter(({ type }) => profile.advancedConfig['geodata-mode'] || !type.startsWith('GEO'))
    .map((rule) => generateRule(rule))

  return config
}

export const generateConfigFile = async (profile: ProfileType) => {
  const header = `# DO NOT EDIT - Generated by ${APP_TITLE}\n`

  const config = await generateConfig(profile)

  await Writefile(KernelConfigFilePath, header + stringify(config))
}

export const addToRuleSet = async (ruleset: 'direct' | 'reject' | 'proxy', payload: string) => {
  const path = `data/rulesets/${ruleset}.yaml`
  const content = (await ignoredError(Readfile, path)) || '{}'
  const { payload: p = [] } = parse(content)
  p.unshift(payload)
  await Writefile(path, stringify({ payload: [...new Set(p)] }))
}
