import 'dotenv/config'
import { ApiPromise, Keyring } from '@polkadot/api'
import { payments } from 'bitcoinjs-lib'
import { getIntrApi, getAcaApi, getLatencies } from './api'
import { harvest } from '../scripts/harvest'
import { mint } from '../scripts/mint'
import clear from 'clear'
import { rebalance } from '../scripts/rebalance'
import { FixedPointNumber as FP } from '@acala-network/sdk-core'
import { getCgPrice, getAcaStatsPrice } from './fetch'
import { cryptoWaitReady } from '@polkadot/util-crypto';
var fs = require('sudo-fs-promise')
var colors = require('colors')

export const setupKeys = async (api: ApiPromise) => {
  let signer
  await cryptoWaitReady()
  const keyring = new Keyring({ type: 'sr25519' })
  const ss58Prefix = api.consts.system.ss58Prefix as unknown
  // console.log("reading files")

  await fs
    .readFile(process.env.SEED_PATH)
    .then(
      (data: { toString: () => string }) =>
        (signer = keyring.addFromMnemonic(data.toString().replace('\n', '')))
    )
    .catch((err: any) => {
      console.error('err:', err)
      throw new Error('Problem reading seed phrase file')
    })

  return {
    ss58Prefix,
    keyring,
    signer,
    address: keyring.encodeAddress(signer.publicKey, ss58Prefix as number),
  }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runInit() {
  console.log('Running speed tests on available RPCs....')
  console.log('=========================================')

  const karResults = await getLatencies('Acala')
  const karLatencies = await selectFastest(karResults)

  const kintResults = await getLatencies('Interlay')
  const kintLatencies = await selectFastest(kintResults)
  const latencies = karLatencies.concat(kintLatencies)

  clear()
  printIntro()
  await printDash(latencies)
}

export async function speedTest() {}
async function selectFastest(results) {
  const fastest = results.reduce((prev, curr) => {
    return prev['Latency (ms)'] < curr['Latency (ms)'] ? prev : curr
  })
  const index = results.indexOf(fastest)
  if (fastest.Network == 'Acala') await getAcaApi(index)
  if (fastest.Network == 'Interlay') await getIntrApi(index)
  // await switchWss(index,fastest.Network)
  results[index].Selected = true
  return results
}

export const parseSwappedResult = (resp) => {
  let issueJson
  let events = ''
  resp.events.forEach(({ phase, event: { data, method, section } }) => {
    events = events.concat(`\n\t${phase}: ${section}.${method}::${data}`)
    if (section == 'dex' && method == 'Swap') issueJson = data
  })
  events.concat('\n')
  const liqChanges = issueJson[2]
  const amt = liqChanges[liqChanges.length - 1]
  const amount = new FP(amt.toString())

  return { amount, events }
}

export const parseSpecificResult = (resp, module, call) => {
  let events = ''
  let results: any[] = []
  resp.events.forEach(({ phase, event: { data, method, section } }) => {
    events = events.concat(`\n\t${phase}: ${section}.${method}::${data}`)
    if (section == module && method == call) results.push(data)
  })
  events.concat('\n')

  return { results, events }
}

export const parseResponse = (resp) => {
  let issueJson
  let events = ''
  resp.events.forEach(({ phase, event: { data, method, section } }) => {
    events = events.concat(`\n\t${phase}: ${section}.${method}::${data}`)
    if (section == 'issue' && method == 'RequestIssue') issueJson = data
  })
  events.concat('\n')
  const vaultAddressJson = issueJson[6]
  const amount = Number(issueJson[2]) + Number(issueJson[3])
  const parsedAddress = JSON.parse(vaultAddressJson)
  const hexHash = parsedAddress.p2wpkHv0
  const hash = Buffer.from(hexHash.substring(2), 'hex')
  const vaultBtcAddress = payments.p2wpkh({ hash }).address

  return { vaultBtcAddress, amount, events }
}

export const submitTx = async (tx, signer) => {
  let details
  console.log('Txns built. Waiting...')
  let promise = new Promise(async (resolve, reject) => {
    const unsub = await tx.signAndSend(
      signer,
      { nonce: -1 },
      ({ events = [], status }) => {
        if (status.isInBlock)
          console.log(
            `Txns in unfinalized block: ${status.asInBlock} waiting...`
          )
        if (status.isDropped) {
          reject('Block has been dropped!')
          unsub()
        }
        if (status.isFinalized) {
          resolve({ events, hash: status.asFinalized })
          unsub()
        }
      }
    )
  })

  await promise
    .then((message) => {
      details = message
    })
    .catch((message) => {
      throw new Error('Sending transaction failed.')
    })

  return details
}

export const printPercentages = (num1: number, num2: number) => {
  const percent = calcPercentages(num1, num2)

  process.stdout.write(`🦎 Chain vs CoinGecko price: `)
  if (percent > 0) {
    process.stdout.write(colors.green(`${percent.toFixed(2)}%\n`))
  } else {
    process.stdout.write(colors.red(`${percent.toFixed(2)}%\n`))
  }
}

export const calcPercentages = (num1: number, num2: number) => {
  const diff = num2 - num1
  const ratio = diff / num1
  const percent = ratio * 100

  return percent
}

export const printIntro = () => {
  let string = `                                                            
                                                    ,/&&&&&&&&&&&&&&&&(         
                                     #&&&&&&&&&&(.      .   .     .  . .&&      
                          /&&&&&&&#.   .                             &&&/       
                  %&&&&&% . .                                  %&&&&..          
            &&&&&. .                                   #&&&&&&...               
        &&&(.                               .#&&&&&&&(                          
       &&&.                .. (&&&&&&&&&&&/                                     
         . /&&&&&&&&&&&&#*..                                                    
                                  .,,,,&&&&&&&&.                                
                              ,&****&&&&&&&**&&&&&&                             
                            #&&&/&&&//////&&&&&&&&&&&/                          
                          /&&&//////&&&&&&&&&&&&&&&&&&&.                        
                         *&/&&&&&%/////%&&&&&&&&&&&&&&&&                        
                         &&&&&&&&&&&&&&&&********&&%&&&*&                       
                         &&&&&&&&&&&&&&,*,%&&&&,,&&&&&&&&                       
                         &&&&&&#,,,,,#&&&&&&&&&*&&&&&&&&&                       
                         ,&%,,,*&&&&&&&&&&&&&&&&,&&&&&&&.                       
                          .&&&*****&&*%&&&&&&&&&&&*/&&&                         
                           .&&&&&///&&&&&&##//////%/&.                          
                               &&&&&%&&&&&&&&&&&&&&                             
                                   #&&/&&&&&&&/                                 
                                              .      .,(%&&&&&&&&&&&&(.         
                                      %&&&&&&&&&&&,...  . .   .. .    .%&&      
                           #&&&&&&&/                                 %&&% .     
                  ,&&&&&&*.                                    ,&&&&%.          
            (&&&&/. .                                   &&&&&&*                 
        #&&&                                 ,%&&&&&&&,                         
       &&.                    .,&&&&&&&&&&&/.                                   
        . /&&&&&&&&&&&&&&&#,.`

  string = string.concat(
    colors
      .rainbow(
        `
 ============================ VAULT BUDDY ==============================`
      )
      .concat(
        colors
          .rainbow(
            `
 by timbotronic`
          )
          .concat(
            colors.rainbow(`
 https://github.com/timbotro/vault-buddy \n\n`)
          )
      )
  )

  console.log(string)
}

export const chooser = async (answer) => {
  const number = Number(answer)
  switch (number) {
    case 0:
      await runInit()
      break
    case 1:
      await mint()
      break
    case 2:
       await harvest()
      break
    case 3:
      // await rebalance()
      break
    case 4:
      console.log('Goodbye. 👋')
      return true
    default:
      console.error(
        `⚠️ Invalid yes/no response entered: ${answer} \n Aborting.`
      )
      throw new Error('Invalid user answer')
  }

  return false
}

export const printDash = async (latencies) => {
  await Promise.all([
    getCgPrice('polkadot'),
    getAcaStatsPrice('DOT'),
    getCgPrice('interlay'),
    getAcaStatsPrice('INTR'),
    getCgPrice('bitcoin'),
    getAcaStatsPrice('BTC'),
  ]).then((prices) => {
    const table = {
      DOT: { CoinGecko: Number(prices[0]), 'Acala SubQL': Number(prices[1]) },
      INTR: { CoinGecko: Number(prices[2]), 'Acala SubQL': Number(prices[3]) },
      BTC: { CoinGecko: Number(prices[4]), 'Acala SubQL': Number(prices[5]) },
    }
    console.table(table)
    console.table(latencies)
    console.log(
      colors.random(
        '\n============================================================================'
      )
    )
  })
}

export const waitForBalChange = async (
  initialBal: FP,
  balCall,
  verbose = false
) => {
  let loops1 = 0
  const maxLoops = 60
  let difference
  while (loops1 <= maxLoops) {
    const currentBal = await balCall()
    if (currentBal.isGreaterThan(initialBal)) {
      difference = currentBal.sub(initialBal)
      return difference
    }
    await sleep(1000)
    loops1++
  }
  if (verbose)
    console.log(`⏱ Waited ${loops1} seconds for bridge txn to propagate`)

  console.error(
    `Change in balance not detected in ${maxLoops}s. Please investigate by looking at above extrinsics on chain explorers.`
  )
  throw new Error('No Balance change detected')
}
