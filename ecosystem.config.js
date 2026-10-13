module.exports = {
  apps: [{
    name: 'home',
    script: 'npx',
    args: 'http-server dist -p 3000 -a 127.0.0.1',
    instances: 1,
    autorestart: true,
    watch: false
  }]
};
