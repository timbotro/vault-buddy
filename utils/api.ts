import {ApiPromise, WsProvider} from '@polkadot/api'
import {ApiOptions} from '@polkadot/api/types'
import {performance} from 'perf_hooks'

type Chains = 'Acala' | 'Interlay'

const interlayWss = [
    'wss://api.interlay.io/parachain',
    'wss://interlay.api.onfinality.io/public-ws'
]

const acalaWss = [
    'wss://acala-rpc-0.aca-api.network',
    'wss://acala-rpc-1.aca-api.network',
    'wss://acala-rpc-2.aca-api.network/ws',
    'wss://acala-rpc-3.aca-api.network/ws',
    'wss://acala.polkawallet.io',
    'wss://acala-polkadot.api.onfinality.io/public-ws'
]

export class SubstrateApi {
    private _api?: ApiPromise

    public get api() {
        return this._api
    }

    public async init(options: ApiOptions) {
        await this.connect(options)
        await this._api?.isReadyOrError
        return this
    }

    public async measure(options: ApiOptions) {
        const startTime = performance.now()
        await this.connect(options)
        await this._api?.isReady
        const endTime = performance.now()
        const duration = endTime - startTime
        await this._api?.disconnect()

        return duration.toFixed(0)
    }

    public async switch(prov: number, network: Chains) {
        await this._api?.disconnect()
        const provider = chooseWss(network, prov)
        await this.connect({provider})
        await this._api?.isReady
    }

    private async connect(options: ApiOptions) {
        this._api = await ApiPromise.create(options)
        this._api.on('error', async (e) => {
            console.log(`Api error: ${JSON.stringify(e)}, reconnecting....`)
            await this.connect(options)
        })
    }
}

let karApi: SubstrateApi
let kintApi: SubstrateApi

export async function switchWss(prov: number, network: Chains) {
    switch (network) {
        case 'Acala':
            await karApi.switch(prov, network)
            break
        case 'Interlay':
            await kintApi.switch(prov, network)
            break
        default:
            throw new Error('Unrecognised network')
    }
}

export async function getLatencies(network: Chains) {
    let latencies: any[] = []
    let promises = []
    let wssList
    switch (network) {
        case 'Acala':
            wssList = acalaWss
            break
        case 'Interlay':
            wssList = interlayWss
            break
        default:
            throw new Error('Unrecognised')
    }

    for (let i = 0; i < wssList.length; i++) {
        const promise = new Promise(async (resolve, reject) => {
            const startTime = performance.now()
            const provider = new WsProvider(
                wssList[i]
            )

            provider.on('connected', async () => {
                const api = await ApiPromise.create({provider})
                const duration = performance.now() - startTime
                const row = {
                    Network: network,
                    WSS: wssList[i],
                    'Latency (ms)': Number(duration.toFixed(0)),
                    Selected: false,
                }
                latencies.push(row)
                await api.disconnect()
                resolve(true)
            })

            provider.on('error', async () => {
                console.error(`Error connecting to ${wssList[i]}`)
                const row = {
                    Network: network,
                    WSS: wssList[i],
                    'Latency (ms)': Number(9999),
                    Selected: false,
                }
                latencies.push(row)
                await provider.disconnect()
                reject(false)
            })
        })
        //@ts-ignore
        promises.push(promise)
    }

    await Promise.allSettled(promises)
        .then(() => {
            console.log(`${network} Benchmark Complete`)
        })
        .catch(() => {
            console.error('One of the RPCs have failed')
        })
    return latencies
}

export async function getAcaApi(endpoint: number = 0) {
    if (!karApi) {
        const provider = chooseWss('Acala', endpoint)
        karApi = await new SubstrateApi().init({
            provider: provider,
        })
    }

    return karApi.api
}

export async function getIntrApi(endpoint: number = 0) {
    if (!kintApi) {
        const provider = chooseWss('Interlay', endpoint)
        kintApi = await new SubstrateApi().init({
            provider: provider,
        })
    }

    return kintApi.api
}

function chooseWss(
    network: Chains,
    number: number = 0,
    retry: false | number = 5000
) {
    switch (network) {
        case 'Acala':
            return new WsProvider(acalaWss[number])
        case 'Interlay':
            return new WsProvider(interlayWss[number])
        default:
            throw new Error(`Invalid network ${network}`)
    }
}
