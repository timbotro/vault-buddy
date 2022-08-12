import { sleep, parseSwappedResult, waitForBalChange } from '../utils/helpers'
import { setupInterlay } from '../utils/interlay'
import { setupAcala } from '../utils/acala'
import { printSuccess } from '../utils/fetch'
import { FixedPointNumber as FP } from '@acala-network/sdk-core'
import { confirmMessage, harvestQ1, harvestQ2 } from '../utils/inquirer'

export async function harvest() {
  const interContext = await setupInterlay()
  await interContext.printStats()
  const acaContext = await setupAcala()

  const intrHarvest = await interContext.getIntrPending()
  const dotHarvest =
    Number(intrHarvest) * Number(await acaContext.getDotIntrPrice())
  await acaContext.printStats(intrHarvest, dotHarvest)

  const answer1 = await harvestQ1()
  if (!answer1.harvestIntro) {
    console.log('Goodbye. 👋')
    return
  }

  const interAmount = await interContext.getIntrFree()
  if (Number(intrHarvest) + Number(interAmount) < 1) {
    console.error(
      `Insufficient amount to bridge and convert, only ${
        intrHarvest + interAmount
      } INTR free`
    )
    throw new Error('Insufficient harvest')
  }
  const max = Number(intrHarvest) + Number(interAmount) - 1
  const answer2 = await harvestQ2(max)

  console.log('=============================')
  process.stdout.write('(1/4) Claiming and Bridging rewards....')
  const initialIntrBal = await acaContext.getIntrFree()
  try {
    let step1txns: any[] = []
    if (Number(intrHarvest) > 1) {
      const txn = interContext.claimRewards()
      step1txns.push(txn)
    }
    const bridgeAmount = new FP(answer2.harvestInput, 12)
    const txn = interContext.bridgeToAcala(bridgeAmount)
    step1txns.push(txn)
    const hash = await interContext.submitBatch(step1txns)
    await printSuccess('interlay', hash.hash)
  } catch (e) {
    console.error(e)
    throw new Error('error on step1')
  }
  
  const diff1 = await waitForBalChange(initialIntrBal, acaContext.getIntrFree)
  process.stdout.write(
    `(2/4) Swapping ${diff1.div(new FP(10 ** 12)).toNumber(5)} INTR for DOT....`
  )
  const hash2 = await acaContext.swapIntrForDotTxn(diff1)
  await printSuccess('acala', hash2.hash)
  const { amount } = parseSwappedResult(hash2)

  process.stdout.write(
    `(3/4) Bridging back ${amount
      .div(new FP(10 ** 12))
      .toNumber(5)} DOT....`
  )

  const initialDotBal = await interContext.getDotFree()
  const hash3 = await acaContext.bridgeDotToIntr(amount)
  await printSuccess('acala', hash3.hash)
  const diff2 = await waitForBalChange(initialDotBal, interContext.getDotFree)

  process.stdout.write(
    `(4/4) Depositing ${diff2
      .div(new FP(10 ** 12))
      .toNumber(5)} DOT Collateral back into vault...`
  )
  const hash5 = await interContext.depositCollateral(diff2)
  await printSuccess('interlay', hash5.hash)

  console.log(`✅  Collateral Ratio is now: ${await interContext.getRatio()}%`)
  await confirmMessage()
}
