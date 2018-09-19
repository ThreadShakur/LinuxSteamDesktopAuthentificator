var steam = function (login, password, shared_secret, identity_secret, steamguard, oAuthToken) {
  const SteamCommunity = require('steamcommunity')
  const SteamTOTP = require('steam-totp')

  this.client = new SteamCommunity()

  var self = this
  this.ipc = null
  this.login_callback = null
  this.login = login
  this.password = password
  this.identity_secret = identity_secret
  this.shared_secret = shared_secret
  this.steamguard = steamguard
  this.oAuthToken = oAuthToken


  this.init_ipc = function (ipc_) {
    self.ipc = ipc_
  }

  this.init_logincallback = function (callback) {
    self.login_callback = callback
  }

  // Login with 2fa
  this.login_2fa = function () {

    self.client.login({
      "accountName": self.login,
      "password": self.password,
      "twoFactorCode": SteamTOTP.generateAuthCode(self.shared_secret)
    }, function (err, sessionID, cookies, steamguard, oAuthToken) {
      if (err) {
        self.ipc.send('login_error', 'Ошибка при входе: ' + err)
        return
      }

      self.steamguard = steamguard
      self.oAuthToken = oAuthToken
  
      self.login_callback(self.login, self.password, self.shared_secret, self.identity_secret, steamguard, oAuthToken, self)
    })
  }

  // Login wout 2fa, to enable 2fa
  this.login_wout2fa = function (authCode, callback) {


    self.client.login({
      "accountName": self.login,
      "password": self.password,
      "authCode": authCode
    }, function (err, sessionID, cookies, steamguard, oAuthToken) {
      if(err) {

        if(err.message == 'SteamGuardMobile') {
          self.ipc.send('enable_2fa_error', 'На этом аккаунте уже есть 2FA аутентификация, попробуйте добавить аккаунт другим методом')
          return
        }

        if(err.message == 'SteamGuard') {
          self.ipc.send('notification', {title: 'Внимание', body: 'На вашу почту: ' + err.emaildomain + ' отправлено письмо с кодом Steam Guard'})
          self.ipc.send('show_mailcode_field', null)
          return
        }

        if(err.message == 'CAPTCHA') {
          console.log(err.captchaurl)
          return
        }

        self.ipc.send('login_error', 'Ошибка при входе: ' + err.message)
        return
      }

      var final_callback = function (data) {
        self.ipc.send('show_smsfield', null)

        self.shared_secret = data.shared_secret
        self.identity_secret = data.identity_secret
        self.steamguard = steamguard
        self.oAuthToken = oAuthToken

        callback(self.login, self.password, data.shared_secret, data.identity_secret, steamguard, oAuthToken, self, true, data.revocation_code)
      }

      self.enable_2fa(final_callback)
    })
  }

  this.enable_2fa = function (final_callback) {

    self.client.enableTwoFactor(function(err, response) {

      if(err) {
        if(err.eresult == 2) {
          self.ipc.send('enable_2fa_error', 'Привяжите телефон к аккаунту')
          return
        }

        if(err.eresult == 84) {
          self.ipc.send('enable_2fa_error', 'Попробуйте позже')
          return
        }

        console.log(err)
        return
      }

      if(response.status != 1) {
        self.ipc.send('enable_2fa_error', 'Статус: ' + response.status)
        return
      }
      
      final_callback(response)
    })
  }

  this.finalize_2fa = function (code) {
    self.client.finalizeTwoFactor(self.shared_secret, code, function(err) {
      if(err) {
        if(err.message == "Invalid activation code") {
          self.ipc.send('enable_2fa_error', 'Неверный СМС код')
        }

      } else {
        self.ipc.send('notification', {title: 'Двухфакторная аутентификация включена!', body: ''})
        self.ipc.send('reload_accounts')
        self.ipc.send('account_added')
      }
    })
  }

  this.fast_login = function () {
    self.client.oAuthLogin(self.steamguard, self.oAuthToken, function (err, sessionID, cookies) {
      if (err) self.ipc.send('login_error', 'Ошибка при входе: ' + err)
    })
  }

  this.get_confirmations = function (name, callback) {
    SteamTOTP.getTimeOffset(function (err, offset) {
      var time = SteamTOTP.time() + offset

      var conf_key = SteamTOTP.getConfirmationKey(self.identity_secret, time, 'conf')
      self.client.getConfirmations(time, conf_key, function (err, confirmations) {
        if (err) {
          return
        }

        callback(name, confirmations)
      })
    })
  }

  this.accept_offer = function (id, key) {
    SteamTOTP.getTimeOffset(function (err, offset) {
      var time = SteamTOTP.time() + offset

      var allow_key = SteamTOTP.getConfirmationKey(self.identity_secret, time, 'allow')
      self.client.respondToConfirmation(id, key, time, allow_key, true, function (err) {
        if (err) self.ipc.send('notification', {title: 'Ошибка при подтверждении обмена', body: err.message})
      })
    })
  }

  this.decline_offer = function (id, key) {
    SteamTOTP.getTimeOffset(function (err, offset) {
      var time = SteamTOTP.time() + offset
      var cancel_key = SteamTOTP.getConfirmationKey(self.identity_secret, time, 'cancel')
      self.client.respondToConfirmation(id, key, time, cancel_key, false, function (err) {
        if (err) self.ipc.send('notification', {title: 'Ошибка при отмене обмена', body: err.message})
      })
    })
  }

  this.client.on('sessionExpired', function (err) {
    if (self.steamguard && self.oAuthToken) self.fast_login()
    else self.login_2fa()
  })
}


module.exports.steam = steam
