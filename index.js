const {app, BrowserWindow, Menu} = require('electron')
const totp = require('steam-totp')
const fs = require('fs')
const steam = require('./js/steam')


var ipc = require('electron').ipcMain
var win = null

ipc.on('delete_acc', function (event, id) {
  global.accounts.splice(id, 1)
  sync_datafile()
})


ipc.on('edit_acc', function (event, data) {
  global.accounts[data.id] = data.account
  sync_datafile()
})


ipc.on('create_with2fa', function (event, data) {
  let client = new steam.steam(data[0], data[1], data[2], data[3])
  client.init_ipc(win.webContents)
  client.init_logincallback(finalize_login)

  client.login_2fa(finalize_login)
})


ipc.on('create_wout2fa', function (event, data) {
  let client = new steam.steam(data[0], data[1])
  client.init_ipc(win.webContents)
  client.init_logincallback(finalize_login)

  client.login_wout2fa(data[2], finalize_login)
})


ipc.on('finalize', function (event, data) {
  let account = find_acc(data[0])
  if (account !== null) {
    account = global.accounts[account]
    account.client.finalize_2fa(data[1])
  }
})


ipc.on('login', function (event, login) {

  let account = find_acc(login)

  if (account !== null) {
    account = global.accounts[account]

    if (account.client !== undefined) return

    let client = new steam.steam(account.name, account.password, account.shared_secret, account.identity_secret, account.steamguard, account.oAuthToken)
    client.init_ipc(win.webContents)
    client.init_logincallback(finalize_login)

    if (account.steamguard && account.oAuthToken) {
      client.fast_login()
      if (account.client === undefined) account.client = client
    } else {
      client.login_2fa(finalize_login)
    }
  }
})


ipc.on('get_confirmations', function (event, name) {
  let account = global.accounts[find_acc(name)]

  if (account !== undefined && account.client !== undefined) {
    account.client.get_confirmations(name, confirmations_callback)
  }
})


var confirmations_callback = function (name, confirmations) {
  win.webContents.send('new_confirmations', {name: name, confirmations: confirmations})
}


ipc.on('accept_offer', function (event, data) {
  let account = global.accounts[find_acc(data.name)]

  if (account !== undefined) {
    account.client.accept_offer( data.id, data.key)
  }
})


ipc.on('decline_offer', function (event, data) {
  let account = global.accounts[find_acc(data.name)]

  if (account !== undefined) {
    account.client.decline_offer(data.id, data.key)
  }
})

global.accounts = JSON.parse(fs.readFileSync('data.json'))

var sync_datafile = function () {
  let temp = Object.assign({}, global.accounts)

  for (let item in temp) {
    temp[item].client = undefined
    temp[item].confirmations = undefined
  }

  fs.writeFileSync('data.json', JSON.stringify(global.accounts))
}

var find_acc = function (login) {
  for (let i in global.accounts) {
    if (global.accounts[i].name == login) {
      return i
    }
  }

  return null
}

var finalize_login = function (login, password, shared_secret, identity_secret, steamguard, oAuthToken, client, acc_creation = false, revocation_code = null) {
  let account = find_acc(login)

  if (account !== null) {
    global.accounts[account].steamguard = steamguard
    global.accounts[account].oAuthToken = oAuthToken

    global.accounts[account].client = client

    sync_datafile()
  } else {
    let length = global.accounts.push({
      'name': login,
      'password': password,
      'shared_secret': shared_secret,
      'identity_secret': identity_secret,
      'auth_code': '-',
      'steamguard': steamguard,
      'oAuthToken': oAuthToken,
      'revocation_code': revocation_code
    })

    sync_datafile()

    global.accounts[length - 1].client = client

    if (!acc_creation) {
      win.webContents.send('reload_accounts')
      win.webContents.send('account_added')
    }
  }
}


function createWindow () {
  // Create the browser window.

  win = new BrowserWindow({width: 400, height: 630,  icon: 'logo.png'})
  win.setResizable(false)
  // и загрузит index.html приложение.
  win.loadFile('index.html')

  //win.webContents.openDevTools()
  //win.loadURL('http://127.0.0.1:8080')
}
  
app.on('ready', createWindow)

const menuTemplate = [
  {
    label: 'Файл',
    submenu: [
      {role: 'close', label: 'Выход'}
    ]
  }
]

Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))


global.generate_auth_code = function (shared_secret) {
  try {
    return totp.generateAuthCode(shared_secret)
  } catch ( err ) {
    return "INVALID SHARED_SECRET"
  }
}