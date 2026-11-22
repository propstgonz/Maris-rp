




import { Events, ActivityType } from 'discord.js';
import logger                   from '../utils/logger.js';
import { whenReady as whenDbReady } from '../database/index.js';
import { startCronJobs }        from '../services/cronService.js';
import { deployCommandsOnBoot } from '../services/commandDeployService.js';
import { startInstanceGuard } from '../services/instanceGuardService.js';
import { startTerminalJobPoller } from '../services/terminalJobService.js';
import { startBotJobPoller }      from '../services/botJobService.js';
import { startActivityEchoPoller } from '../services/activityEchoService.js';

export default {
  name: Events.ClientReady,
  once: true,


  async execute(readyClient) {



    logger.attachClient(readyClient);

    logger.info('══════════════════════════════════════');
    logger.info(`✅  Bot conectado como: ${readyClient.user.tag}`);
    logger.info(`    Servidores activos: ${readyClient.guilds.cache.size}`);
    logger.info(`    Comandos cargados:  ${readyClient.commands.size}`);
    logger.info('══════════════════════════════════════');


    readyClient.user.setPresence({
      activities: [{ name: 'el mercado | /jugar', type: ActivityType.Watching }],
      status: 'online',
    });







    await whenDbReady;






    await startInstanceGuard();




    await deployCommandsOnBoot(readyClient);



    await startCronJobs(readyClient);



    startTerminalJobPoller(readyClient);





    startBotJobPoller(readyClient);
    startActivityEchoPoller(readyClient);
  },
};
