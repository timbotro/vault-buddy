import { sleep, waitForBalChange, parseSpecificResult } from '../utils/helpers'
import { printSuccess } from '../utils/fetch'
import { FixedPointNumber as FP } from '@acala-network/sdk-core'
import { setupKintsugi } from '../utils/interlay'
import { setupKarura } from '../utils/acala'
import { rebalanceQ1, rebalanceQ2, confirmMessage } from '../utils/inquirer'
var colors = require('colors')

export async function rebalance() {
  const ktContext = await setupKintsugi()
  await ktContext.printStats()
  const karContext = await setupKarura()

  const resp = await karContext.getStakedLpBalance()
  console.log('🏦 LP tokens owned: ', resp.toString())
  const TotalLPValue = await karContext.getMySharesValueView()
  console.log(`💵 Total LP value: $${TotalLPValue}`)
  const resp8 = await karContext.getMySharesInKsmView()
  console.log(`🧮 LP shares as collateral: ${resp8} KSM`)
  const resp9 = await karContext.getMySharesInKsm()
  const ratio = await ktContext.getCollateralRatio(resp9)
  const ratioAvailable = Number(await ktContext.getRatio()) - 260
  const negRatio = ratioAvailable < 0 ? 0 : (ratioAvailable * -1).toFixed(2)

  console.log(
    `⚖️  Max LP/Collateral rebalancing: ` +
      colors.red(`${negRatio}% `) +
      ' / ' +
      colors.green(`+${ratio.toNumber(2)}% `)
  )

  const answer1 = await rebalanceQ1()
  if (!answer1.rebalanceIntro) {
    console.log('Goodbye. 👋')
    return
  }

  const answer2 = await rebalanceQ2(negRatio, ratio)
  const number = Number(answer2.rebalanceInput)
  console.log('=============================')

  if (number > 0) {
    const ksmAmount = await ktContext.getCollateralFromRatio(number)
    const ksmPrice = await karContext.getKsmPrice()
    const ksmValue = ksmAmount.mul(ksmPrice)
    const shares = (await karContext.getStakedLp()).balance
    const totalVal = await karContext.getMySharesValue()
    const valPerShare = totalVal.div(shares)
    const sharesToWithdraw = new FP(ksmValue.toNumber(0), 0).div(valPerShare)

    process.stdout.write(
      `(1/4) Withdrawing ${sharesToWithdraw
        .div(new FP(10 ** 12))
        .toNumber(2)} staked LP shares ....`
    )
    const hash1 = await karContext.withdrawLpShares(sharesToWithdraw)
    await printSuccess('karura', hash1.hash)
    const { results } = parseSpecificResult(hash1, 'currencies', 'Transferred')
    const kusdReceived = new FP(results[1][3].toString())
    const kbtcReceived = new FP(results[2][3].toString())

    process.stdout.write(`(2/4) Swapping withdrawn shares for KSM....`)
    const hash2 = await karContext.swapKusdKbtcforKsm(
      kusdReceived,
      kbtcReceived
    )
    await printSuccess('karura', hash2.hash)

    const initialKsmOnKt = await ktContext.getKsmFree()
    process.stdout.write(
      `(3/4) Bridging back ${hash2.returned
        .div(new FP(10 ** 12))
        .toNumber(5)} KSM....`
    )
    const hash3 = await karContext.bridgeKsmToKint(hash2.returned)
    await printSuccess('karura', hash3.hash)
    const diff = await waitForBalChange(initialKsmOnKt, ktContext.getKsmFree)
    process.stdout.write(
      `(4/4) Depositing ${diff
        .div(new FP(10 ** 12))
        .toNumber(5)} KSM Collateral back into vault...`
    )
    const hash5 = await ktContext.depositCollateral(diff)
    await printSuccess('kintsugi', hash5.hash)

  } else {
    const initialBal = await karContext.getKsmFree()
    const hash1 = await ktContext.withdrawCollateralAndBridge(-number, initialBal, karContext.getKsmFree)
    await printSuccess('kintsugi', hash1.hash)

    const hash2 = await karContext.swapKsmForDexShare(hash1.bridged)
    await printSuccess('karura', hash2.hash)

    const hash3 = await karContext.depositLpShares()
    await printSuccess('karura', hash3.hash)
  }

  console.log('=============================')
  console.log(`✅  Collateral Ratio is now: ${await ktContext.getRatio()}%`)
  await confirmMessage()
}
