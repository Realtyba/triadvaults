import { Router } from 'express';
import { DatabaseManager } from '../../db/index.js';

export const achievementsRouter = Router();

/**
 * Catálogo vigente, para que el cliente pinte el perfil y los avisos.
 *
 * Sin autenticar: es la lista de metas del juego, la misma para todo el mundo, y el
 * menú tiene que poder dibujarla antes de que nadie inicie sesión.
 *
 * Las condiciones NO se envían. El cliente no evalúa nada —quien concede es el
 * servidor— así que mandar las reglas solo serviría para sugerir lo contrario. Lo
 * que hace falta para desbloquear un logro ya lo cuenta su descripción.
 */
achievementsRouter.get('/', async (req, res) => {
  const catalog = await DatabaseManager.getAchievementCatalog();

  res.json({
    success: true,
    // `steamApiName` sí viaja: lo necesita el cliente de escritorio para decirle a
    // Steam qué logro reflejar. No es un secreto —está en la ficha pública del
    // juego— y quien decide concederlo sigue siendo el servidor.
    catalog: catalog.map(({ key, icon, title, description, steamApiName, sortOrder }) => ({
      key,
      icon,
      title,
      description,
      steamApiName,
      sortOrder
    }))
  });
});
