import { InsertParams, QueryParams, QueryResponse, TiDbClientParams } from "./types";
const { DataTypes, Sequelize, fn, Model, col } = require('Sequelize')

//----------------------------------------- Custom Type
class Embedding extends Model { }

function createVectorType() {
    const DataTypes = Sequelize.DataTypes;
    const ABSTRACT = DataTypes.ABSTRACT.prototype.constructor;
    class VectorType extends ABSTRACT {
        toSql() { return 'VECTOR'; }
        parseDatabaseValue(value: unknown): unknown {
            if (value === null || value === undefined || value instanceof Float32Array) return value;
            if (value instanceof Uint8Array) value = new TextDecoder("utf-8").decode(value);
            if (typeof value === "string") {
                if (value === "[]") return new Float32Array([]);
                return new Float32Array(value.slice(1, -1).split(",").map(Number));
            }

            throw new TypeError("Unsupported input type.");
        }
    }
    DataTypes.VectorType = VectorType;
    VectorType.prototype.key = VectorType.key = 'VectorType';
    Sequelize.VectorType = Sequelize.Utils.classToInvokable(VectorType);
}

//----------------------------------------- Init Connection
export async function initConnection(params: TiDbClientParams) {
    const sequelize = new Sequelize({
        dialect: 'mysql',
        dialectOptions: {
            ssl: {
                minVersion: 'TLSv1.2',
                rejectUnauthorized: true
            },
        },
        host: params.host || 'localhost',
        port: params.port || 4000,
        username: params.user || 'root',
        password: params.password || 'root',
        database: params.database || 'test'
    })
    try {
        await sequelize.authenticate();
        createVectorType();
    } catch (error) {
        throw error;
    }
    return sequelize;
}

export function getEmbeddingModel(sequelize: typeof Sequelize, modelName: string) {
    Embedding.init(
        {
            id: {
                type: DataTypes.STRING,
                primaryKey: true,
                allowNull: false
            },
            identifierId: {
                type: DataTypes.STRING,
                allowNull: false
            },
            text: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            embedding: {
                type: DataTypes.VectorType,
                allowNull: false,
            },
        },
        {
            sequelize,
            modelName: modelName,
            tableName: modelName.toLowerCase()
        }
    )

    return Embedding;
}

//----------------------------------------- Calls
export async function add(
    embeddingModel: typeof Embedding,
    { identifierId, ids, embeddings, documents }: InsertParams
) {
    const records = ids?.map((value, index) => {
        return {
            id: value,
            identifierId: identifierId,
            text: documents[index],
            embedding: "[" + embeddings[index].join(",") + "]"
        }
    });

    await embeddingModel.bulkCreate(records!!)
}

export async function query(
    embeddingModel: typeof Embedding,
    { nResults, distanceMethod, identifierId, queryEmbeddings }: QueryParams
): Promise<QueryResponse> {
    const embeddings = await embeddingModel.findAll({
        where: {
            identifierId: identifierId,
        },
        attributes: {
            include: [[fn(distanceMethod!!.valueOf(), col('embedding'), "[" + queryEmbeddings!!.join(",") + "]"), 'distance']]
        },
        order: [['distance', 'ASC']],
        limit: nResults
    });
    return {
        //TODO: standardize returns!
        ids: embeddings.map((em: { toJSON: () => { (): any; new(): any; id: any; }; }) => em.toJSON().id),
        embeddings: embeddings.map((em: { toJSON: () => { (): any; new(): any; embedding: any; }; }) => em.toJSON().embedding),
        documents: embeddings.map((em: { toJSON: () => { (): any; new(): any; text: any; }; }) => em.toJSON().text)
    }
}