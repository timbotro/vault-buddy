import 'dotenv/config'
import {getCgPrice} from './fetch'
import {getAcaApi} from "./api"
import {FixedPointNumber, FixedPointNumber as FP,} from '@acala-network/sdk-core'
import {ausd, ausdIbtcDexshare, dot, ibtcAca as ibtc, intrAca as intr, lcdot, ldot} from '../static/tokens'
import {parseSpecificResult, printPercentages, setupKeys, submitTx,} from './helpers'

export const setupAcala = async () => {
    const api = (await getAcaApi())!

    const {signer, address} = await setupKeys(api)

    const destinationInterlay = {
        V1: {
            parents: 1,
            interior: {
                X2: [
                    {
                        Parachain: 2032,
                    },
                    {
                        AccountId32: {network: 'Any', id: signer.publicKey},
                    },
                ],
            },
        },
    }

    const getAcaBalance = async () => {
        const resp = (await api.query.system.account(address)) as any
        const bal = resp.data.free
        return (Number(bal) / 10 ** 12).toFixed(2)
    }
    const getDexPrices = async (tokenA = intr, tokenB = dot) => {
        const respIntr = (
            (await api.query.dex.liquidityPool([ausd, tokenA])) as any
        ).toJSON()
        const respDot = (
            (await api.query.dex.liquidityPool([ausd, tokenB])) as any
        ).toJSON()
        const tokenAPrice = new FP(respIntr[0]).div(new FP(respIntr[1]))
        const tokenBPrice = new FP(respDot[0]).div(new FP(respDot[1]))
        return {tokenAPrice, tokenBPrice}
    }

    const getDotIntrPrice = async (fp: boolean = false) => {
        const respIntr = (await api.query.dex.liquidityPool([ausd, intr])).toJSON()!
        const respDotLcdot = (await api.query.dex.liquidityPool([dot, lcdot])).toJSON()!
        const respLcdot = (await api.query.dex.liquidityPool([ausd, lcdot])).toJSON()!
        const lcdotPrice = respLcdot[0] / respLcdot[1] / 100
        const intrPrice = respIntr[0] / respIntr[1] / 100
        const dotPrice = lcdotPrice / (respDotLcdot[0] / respDotLcdot[1])

        return fp
            ? new FP(intrPrice / dotPrice)
            : Number(intrPrice / dotPrice).toFixed(5)
    }

    const getMyShares = async () => {
        const {tokenA, tokenB} = await getPoolDepth()
        const totalShares = await getTotalDexShares()
        const myShares = await getStakedLp()

        const myTokenA = tokenA.mul(myShares.balance).div(totalShares)
        const myTokenB = tokenB.mul(myShares.balance).div(totalShares)

        return {myTokenA, myTokenB}
    }

    const getMySharesView = async (precA = 12, precB = 8) => {
        const myShares = await getMyShares()
        const myTokenA = myShares.myTokenA.div(new FP(10 ** precA)).toNumber(6)
        const myTokenB = myShares.myTokenB.div(new FP(10 ** precB)).toNumber(6)
        return {myTokenA, myTokenB: myTokenB}
    }

    const getMySharesValue = async (tokenA = ausd, tokenB = ibtc) => {
        // TODO: Check if a token is ausd and take that to be price=1
        const {myTokenA: tokenAAmount, myTokenB} = await getMyShares()
        // const tokenAPrice = await getDexPrice(kusd, tokenA)
        const tokenBPrice = await getDexPrice(ausd, tokenB)
        const tokenBAmount = myTokenB.mul(tokenBPrice)

        return tokenAAmount.add(tokenBAmount)
    }

    const getShareValue = async (tokenA = ausd, tokenB = ibtc) => {
        // const tokenBPrice = await getDexPrice(kusd, tokenB)
        // const tokenBAmount = myTokenB.mul(tokenBPrice)
        // return tokenAAmount.add(tokenBAmount)
    }

    const getMySharesInDot = async () => {
        const mySharesValue = await getMySharesValue()
        const dotPool = (await api.query.dex.liquidityPool([ausd, dot])).toJSON()!
        const dotPrice = new FP(dotPool[0].toString()).div(
            new FP(dotPool[1].toString())
        )
        return mySharesValue.div(dotPrice)
    }

    const getSharesFromDot = async () => {
        const dotPool = (await api.query.dex.liquidityPool([ausd, dot])).toJSON()!
        const dotPrice = new FP(dotPool[0].toString()).div(
            new FP(dotPool[1].toString())
        )
    }

    const getMySharesInDotView = async () => {
        const resp = await getMySharesInDot()
        const val = resp.div(new FP(10 ** 12))
        return val.toNumber(4)
    }

    const getMySharesValueView = async () => {
        const resp = await getMySharesValue()
        const val = resp.div(new FP(10 ** 12))
        return val.toNumber(2)
    }

    const getDexPrice = async (tokenA, tokenB) => {
        const resp = await api.query.dex.liquidityPool([tokenA, tokenB])
        const json = resp.toJSON()!
        return new FP(json[0].toString()).div(new FP(json[1].toString()))
    }

    const getDotPrice = async () => {
        return await getDexPrice(ausd, dot)
    }

    const getStakedLp = async () => {
        const resp = await api.query.rewards.sharesAndWithdrawnRewards(
            {Dex: ausdIbtcDexshare},
            address
        )
        const json = resp.toJSON()!

        return {balance: new FP(json[0]), rewards: json[1]}
    }

    const getStakedLpBalance = async () => {
        const resp = (await getStakedLp()).balance
        return resp.div(new FP(10 ** 12))
    }

    const getStakedLpBalanceView = async () => {
        const resp = (await getStakedLp()).balance
        return resp.div(new FP(10 ** 12))
    }

    const getTotalDexShares = async () => {
        const resp = await api.query.tokens.totalIssuance(ausdIbtcDexshare)
        return new FP(resp.toString())
    }

    const getPoolDepth = async (pool = [ausd, ibtc]) => {
        const resp = await api.query.dex.liquidityPool(pool)
        const json = resp.toJSON()!
        const tokenA = new FP(json[0].toString())
        const tokenB = new FP(json[1].toString())
        return {tokenA, tokenB}
    }

    const getTokensPerShare = async () => {
        const {tokenA, tokenB} = await getPoolDepth()
        const totalShares = await getTotalDexShares()
        const aPerShare = tokenA.div(totalShares)
        const bPerShare = tokenB.div(totalShares)
        return {aPerShare, bPerShare}
    }

    const printStats = async (intrHarvest, dotHarvest) => {
        const intrPrice = await getCgPrice('interlay')
        const dotPrice = await getCgPrice('polkadot')

        const intrInDot = await getDotIntrPrice()
        const intrInUsd = Number(intrInDot) * dotPrice

        // const diff = calcPercentages(intrPrice, intrInUsd)

        console.log(`🏠 ACA Address: ${address}`)
        console.log(`🚗 ACA Balance (for fees): ${await getAcaBalance()}`)
        console.log(
            `🧮 Acala INTR Price: ${intrInDot} DOT / $${intrInUsd.toFixed(2)}`
        )
        printPercentages(intrPrice, intrInUsd)
        console.log(
            `🌾 Harvestable Amount: ${intrHarvest} INTR / ${dotHarvest.toFixed(
                2
            )} DOT / $${(intrPrice * Number(intrHarvest)).toFixed(2)}`
        )
        console.log('=============================')
    }

    // bridge from interlay

    const bridgeAllDotToIntr = async () => {
        const amount = await getDotFree()
        const txn = api.tx.xTokens.transfer(
            dot,
            amount.toString(),
            destinationInterlay,
            5000000000
        )
        return await submitTx(txn, signer)
    }

    const bridgeDotToIntr = async (amount: FixedPointNumber) => {
        const txn = api.tx.xTokens.transfer(
            dot,
            amount.toString(),
            destinationInterlay,
            5000000000
        )
        return await submitTx(txn, signer)
    }

    const bridgeToIntr = (amount: FixedPointNumber) => {
        return api.tx.xTokens.transfer(
            dot,
            amount.toChainData(),
            destinationInterlay,
            5000000000
        )
    }

    const bridgeToIntrAction = async (amount: FixedPointNumber) => {
        const txn = api.tx.xTokens.transfer(
            dot,
            amount.toString(),
            destinationInterlay,
            5000000000
        )
        return await submitTx(txn, signer)
    }

    const getDotFree = async () => {
        const free = ((await api.query.tokens.accounts(address, dot)) as any).free
        const reserved = ((await api.query.tokens.accounts(address, dot)) as any)
            .reserved
        return new FP(free.toString()).sub(new FP(reserved.toString()))
    }

    const getIntrFree = async () => {
        const free = (
            (await api.query.tokens.accounts(address, intr)) as any
        ).free.toString()
        const reserved = (
            (await api.query.tokens.accounts(address, intr)) as any
        ).reserved.toString()
        return new FP(free, 1).sub(new FP(reserved, 1))
    }

    const swapIntrForDot = (amount: FixedPointNumber) => {
        return api.tx.dex.swapWithExactSupply(
            [intr, ausd, dot],
            amount.toString(),
            0
        )
    }

    const swapIntrForDotTxn = async (amount: FixedPointNumber) => {
        const tx = api.tx.dex.swapWithExactSupply(
            [intr, ausd, dot],
            amount.toString(),
            0
        )
        return await submitTx(tx, signer)
    }

    const swapAllIntrForDot = async () => {
        const intrBalance = await getIntrFree()
        const intrAsDot = intrBalance.mul(
            (await getDotIntrPrice(true)) as FixedPointNumber
        )
        const tx = api.tx.dex.swapWithExactSupply(
            [intr, ausd, dot],
            intrBalance.toString(),
            intrAsDot.mul(new FP(0.98)).toNumber(0)
        )
        return await submitTx(tx, signer)
    }

    const getIbtcBal = async () => {
        const resp = (await api.query.tokens.accounts(address, ibtc)) as any
        return resp.free.toString()
    }
    const getAusdBal = async () => {
        const resp2 = (await api.query.tokens.accounts(address, ausd)) as any
        return resp2.free.toString()
    }

    const swapAusdIbtcforDot = async (ausdBal: FP, ibtcBal: FP) => {
        const txns = [
            api.tx.dex.swapWithExactSupply([ausd, dot], ausdBal.toString(), 0),
            api.tx.dex.swapWithExactSupply([ibtc, ausd, dot], ibtcBal.toString(), 0),
        ]
        const details = await submitBatch(txns)
        const {results} = parseSpecificResult(details, 'dex', 'Swap')
        details.returned = new FP(
            results[0][2][results[0][2].length - 1].toString()
        ).add(new FP(results[1][2][results[1][2].length - 1].toString()))

        return details
    }

    const swapAllForDot = async () => {
        const ibtcBal = await getIbtcBal()
        // const min1 = Number(resp.free) * 0.95 // TODO - add price in DOT for accurate min
        const ausdBal = await getAusdBal()
        // const min2 = Number(resp2.free) * 0.95 // TODO - add price in DOT for accurate min
        const txns = [
            api.tx.dex.swapWithExactSupply([ibtc, ausd, dot], ibtcBal, 0),
            api.tx.dex.swapWithExactSupply([ausd, dot], ausdBal, 0),
        ]
        return await submitBatch(txns)
    }

    const swapDotForDexShare = async (dotAmt: FP) => {
        // const dotAmt = await getDotFree()
        const displayAmt = dotAmt.div(new FP(10 ** 12))

        process.stdout.write(
            `(2/3) Swapping ${dotAmt
                .div(new FP(10 ** 12))
                .toString()} DOT for kBTC and aUSD...`
        )
        dotAmt.setPrecision(0)
        const dotAmount = dotAmt.div(new FP(2))
        const txs = [
            api.tx.dex.swapWithExactSupply(
                [dot, ldot, ausd],
                dotAmount.toString(),
                0
            ),
            api.tx.dex.swapWithExactSupply(
                [dot, ldot, ausd, ibtc],
                dotAmount.toString(),
                0
            ),
        ]
        return await submitBatch(txs)
    }

    const swapIntrForDotAction = async (amount: FixedPointNumber) => {
        const txn = api.tx.dex.swapWithExactSupply(
            [intr, ausd, lcdot, dot],
            amount.toString(),
            0
        )
        return await submitTx(txn, signer)
    }

    const submitBatch = async (calls: any[]) => {
        const txn = api.tx.utility.batchAll(calls)
        return await submitTx(txn, signer)
    }

    const depositLpShares = async () => {
        const ibtcBal = await getIbtcBal()
        const ausdBal = await getAusdBal()

        process.stdout.write(
            `(3/3) Deposting ${new FP(ibtcBal)
                .div(new FP(10 ** 8))
                .toString()} kBTC and ${new FP(ausdBal)
                .div(new FP(10 ** 12))
                .toString()} aUSD into vault...`
        )
        const txn = api.tx.dex.addLiquidity(ausd, ibtc, ausdBal, ibtcBal, 0, true)
        return await submitTx(txn, signer)
    }

    const withdrawLpShares = async (shares: FixedPointNumber) => {
        const txns = [
            api.tx.incentives.withdrawDexShare(
                {DexShare: [ausd, ibtc]},
                shares.toString()
            ),
            api.tx.dex.removeLiquidity(ausd, ibtc, shares.toString(), 0, 0, false),
        ]
        return await submitBatch(txns)
    }

    return {
        api,
        depositLpShares,
        printStats,
        getAcaBalance,
        getDotFree,
        getDotIntrPrice,
        getDotPrice,
        getDexPrices,
        getPoolDepth,
        getMyShares,
        getMySharesView,
        getMySharesValue,
        getMySharesInDot,
        getMySharesInDotView,
        getMySharesValueView,
        getStakedLp,
        getTokensPerShare,
        getStakedLpBalance,
        getStakedLpBalanceView,
        bridgeAllDotToIntr,
        bridgeDotToIntr,
        bridgeToIntr,
        getIntrFree,
        swapAllIntrForDot,
        swapIntrForDotTxn,
        swapAllForDot,
        swapIntrForDot,
        swapDotForDexShare,
        swapAusdIbtcforDot,
        submitBatch,
        withdrawLpShares,
        getTotalDexShares,
    }
}
