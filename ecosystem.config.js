module.exports = {
  apps: [
    {
      name: 'nativelaunch-backend',
      cwd: '/home/ubuntu/native',
      script: 'start-panel.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1'
      },
      time: true,
      restart_delay: 2000,
      max_restarts: 10
    },
    {
      name: 'nativelaunch-frontend',
      cwd: '/home/ubuntu/native',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3318',
      env: {
        NODE_ENV: 'production',
        PORT: 3318
      },
      time: true,
      restart_delay: 2000,
      max_restarts: 10
    }
  ]
};
